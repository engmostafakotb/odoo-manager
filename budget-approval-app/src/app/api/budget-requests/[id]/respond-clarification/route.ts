import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { approvalSteps, budgetRequests, clarifications } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireAuthedUser, handleApiError, HttpError } from "@/lib/api-helpers";
import { requirePermission } from "@/lib/rbac";
import { APPROVAL_CHAIN } from "@/lib/state-machine";
import { recordAuditLog } from "@/lib/audit";

export async function POST(req: Request, ctx: RouteContext<"/api/budget-requests/[id]/respond-clarification">) {
  try {
    const actor = await requireAuthedUser();
    requirePermission(actor.role, "budget:respond-clarification");

    const { id } = await ctx.params;
    const requestId = Number(id);
    const { response } = await req.json();
    if (!response?.trim()) {
      throw new HttpError(400, "A response is required.");
    }

    const [request] = await db.select().from(budgetRequests).where(eq(budgetRequests.id, requestId)).limit(1);
    if (!request) throw new HttpError(404, "Budget request not found.");
    if (request.status !== "CLARIFICATION_REQUESTED") {
      throw new HttpError(409, "This request has no open clarification.");
    }
    if (request.requestorId !== actor.id) {
      throw new HttpError(403, "Only the original requestor can respond to a clarification.");
    }

    const [openClarification] = await db
      .select()
      .from(clarifications)
      .where(and(eq(clarifications.budgetRequestId, requestId), isNull(clarifications.response)))
      .orderBy(desc(clarifications.requestedAt))
      .limit(1);
    if (!openClarification) throw new HttpError(409, "No open clarification found.");

    const [step] = await db
      .select()
      .from(approvalSteps)
      .where(eq(approvalSteps.id, openClarification.approvalStepId))
      .limit(1);
    if (!step) throw new HttpError(404, "Approval step not found.");

    const chainEntry = APPROVAL_CHAIN.find((s) => s.stepOrder === step.stepOrder);
    if (!chainEntry) throw new HttpError(500, "Could not resolve approval chain stage.");

    const respondedAt = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(clarifications)
        .set({ response, respondedAt })
        .where(eq(clarifications.id, openClarification.id));

      await tx.update(approvalSteps).set({ status: "PENDING" }).where(eq(approvalSteps.id, step.id));

      await tx
        .update(budgetRequests)
        .set({ status: chainEntry.status, updatedAt: respondedAt })
        .where(eq(budgetRequests.id, requestId));
    });

    await recordAuditLog({
      entityType: "BUDGET_REQUEST",
      entityId: requestId,
      action: "CLARIFICATION_PROVIDED",
      actorId: actor.id,
      actorRole: actor.role,
      fromStatus: "CLARIFICATION_REQUESTED",
      toStatus: chainEntry.status,
      comments: response,
      ipAddress: req.headers.get("x-forwarded-for"),
    });

    return NextResponse.json({ status: chainEntry.status });
  } catch (err) {
    return handleApiError(err);
  }
}
