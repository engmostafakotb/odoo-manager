import { db } from "@/db/client";
import { approvalSteps, budgetRequests, clarifications } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requirePermission, type Permission } from "@/lib/rbac";
import { HttpError } from "@/lib/api-helpers";
import {
  APPROVAL_CHAIN,
  applyApprovalAction,
  approverRoleForStatus,
  type ApprovalAction,
  type BudgetStatus,
} from "@/lib/state-machine";
import { computeDigitalSignature, recordAuditLog } from "@/lib/audit";
import { processApprovedBudget } from "@/lib/sap/process-approved-budget";
import type { users } from "@/db/schema";

const ACTION_PERMISSION: Record<ApprovalAction, Permission> = {
  APPROVE: "budget:approve",
  REJECT: "budget:reject",
  REQUEST_CLARIFICATION: "budget:request-clarification",
};

const ACTION_LOG_NAME: Record<ApprovalAction, string> = {
  APPROVE: "APPROVED",
  REJECT: "REJECTED",
  REQUEST_CLARIFICATION: "CLARIFICATION_REQUESTED",
};

type SessionUser = typeof users.$inferSelect;

/**
 * Shared core for the three approval-decision endpoints (approve / reject /
 * request-clarification). Validates the actor is the assigned approver for
 * the request's current pending stage, applies the state machine
 * transition, records the approval_steps row with a digital signature, and
 * appends an audit log entry.
 */
export async function applyApprovalDecision(params: {
  requestId: number;
  actor: SessionUser;
  action: ApprovalAction;
  comments?: string;
  ipAddress?: string | null;
}) {
  const { requestId, actor, action, comments, ipAddress } = params;

  requirePermission(actor.role, ACTION_PERMISSION[action]);

  if (action === "REJECT" && !comments?.trim()) {
    throw new HttpError(400, "A comment is required when rejecting a request.");
  }
  if (action === "REQUEST_CLARIFICATION" && !comments?.trim()) {
    throw new HttpError(400, "A comment is required when requesting clarification.");
  }

  const [request] = await db.select().from(budgetRequests).where(eq(budgetRequests.id, requestId)).limit(1);
  if (!request) throw new HttpError(404, "Budget request not found.");

  const expectedRole = approverRoleForStatus(request.status as BudgetStatus);
  if (!expectedRole) {
    throw new HttpError(409, `Request is in status ${request.status} and is not awaiting an approval decision.`);
  }
  if (actor.role !== expectedRole) {
    throw new HttpError(403, `This request is awaiting a ${expectedRole.replace("_", " ")} decision, not ${actor.role}.`);
  }

  const approverIdByRole: Partial<Record<typeof expectedRole, number | null>> = {
    LINE_MANAGER: request.lineManagerId,
    DEPARTMENT_HEAD: request.departmentHeadId,
    FINANCE_CONTROLLER: request.financeControllerId,
  };
  const assignedApproverId = approverIdByRole[expectedRole];
  if (assignedApproverId !== actor.id) {
    throw new HttpError(403, "You are not the assigned approver for this request.");
  }

  // Identify the step to act on by the chain position matching the
  // request's current status, not just "first PENDING step" - all three
  // steps are inserted as PENDING up front, so status alone can't tell
  // them apart.
  const chainEntry = APPROVAL_CHAIN.find((s) => s.status === request.status);
  if (!chainEntry) {
    throw new HttpError(409, `Request is in status ${request.status} and is not awaiting an approval decision.`);
  }
  const [currentStep] = await db
    .select()
    .from(approvalSteps)
    .where(and(eq(approvalSteps.budgetRequestId, requestId), eq(approvalSteps.stepOrder, chainEntry.stepOrder)))
    .limit(1);

  const newStatus = applyApprovalAction(request.status as BudgetStatus, action);
  const actedAt = new Date();
  const digitalSignature = computeDigitalSignature({
    actorId: actor.id,
    timestamp: actedAt,
    entityId: requestId,
    action: ACTION_LOG_NAME[action],
  });

  await db.transaction(async (tx) => {
    if (currentStep) {
      await tx
        .update(approvalSteps)
        .set({
          status: action === "APPROVE" ? "APPROVED" : action === "REJECT" ? "REJECTED" : "CLARIFICATION_REQUESTED",
          comments: comments ?? null,
          digitalSignature,
          actedAt,
        })
        .where(eq(approvalSteps.id, currentStep.id));

      if (action === "REQUEST_CLARIFICATION") {
        await tx.insert(clarifications).values({
          budgetRequestId: requestId,
          approvalStepId: currentStep.id,
          requestedById: actor.id,
          question: comments!,
        });
      }
    }

    await tx
      .update(budgetRequests)
      .set({ status: newStatus, updatedAt: actedAt })
      .where(eq(budgetRequests.id, requestId));
  });

  await recordAuditLog({
    entityType: "BUDGET_REQUEST",
    entityId: requestId,
    action: ACTION_LOG_NAME[action],
    actorId: actor.id,
    actorRole: actor.role,
    fromStatus: request.status as BudgetStatus,
    toStatus: newStatus,
    comments: comments ?? null,
    ipAddress: ipAddress ?? null,
  });

  // Final approval automatically triggers the SAP push. Fire-and-forget so
  // the approver's HTTP request isn't blocked on SAP latency; the UI polls
  // for status.
  if (newStatus === "APPROVED") {
    void processApprovedBudget(requestId);
  }

  return { status: newStatus };
}
