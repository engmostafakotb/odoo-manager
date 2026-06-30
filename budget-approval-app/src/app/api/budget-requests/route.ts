import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { approvalSteps, budgetRequests, users } from "@/db/schema";
import { and, desc, eq, or } from "drizzle-orm";
import { requireAuthedUser, handleApiError, HttpError } from "@/lib/api-helpers";
import { requirePermission } from "@/lib/rbac";
import { recordAuditLog } from "@/lib/audit";
import { APPROVAL_CHAIN } from "@/lib/state-machine";
import { createBudgetRequestSchema, validateAgainstFiscalLimits } from "@/lib/validation";

/**
 * GET /api/budget-requests?scope=mine|pending-my-approval|all
 *   - mine: requests this user created
 *   - pending-my-approval: requests currently awaiting this user's decision
 *   - all: every request (Department Head / Finance / Admin only)
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthedUser();
    const scope = req.nextUrl.searchParams.get("scope") ?? "mine";

    let rows;
    if (scope === "all") {
      requirePermission(user.role, "budget:view:all");
      rows = await db.select().from(budgetRequests).orderBy(desc(budgetRequests.createdAt));
    } else if (scope === "pending-my-approval") {
      rows = await db
        .select()
        .from(budgetRequests)
        .where(
          or(
            and(eq(budgetRequests.status, "PENDING_LINE_MANAGER"), eq(budgetRequests.lineManagerId, user.id)),
            and(eq(budgetRequests.status, "PENDING_DEPARTMENT_HEAD"), eq(budgetRequests.departmentHeadId, user.id)),
            and(eq(budgetRequests.status, "PENDING_FINANCE"), eq(budgetRequests.financeControllerId, user.id)),
          ),
        )
        .orderBy(desc(budgetRequests.createdAt));
    } else {
      rows = await db
        .select()
        .from(budgetRequests)
        .where(eq(budgetRequests.requestorId, user.id))
        .orderBy(desc(budgetRequests.createdAt));
    }

    return NextResponse.json({ budgetRequests: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/budget-requests - submit a new budget request and kick off the approval chain. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthedUser();
    requirePermission(user.role, "budget:create");

    const body = createBudgetRequestSchema.parse(await req.json());
    const fiscalYear = new Date().getFullYear();

    await validateAgainstFiscalLimits({
      costCenterId: body.costCenterId,
      glAccountId: body.glAccountId,
      amount: body.amount,
      fiscalYear,
    });

    if (!user.managerId) {
      throw new HttpError(422, "You have no Line Manager configured. Contact an administrator before submitting.");
    }
    const [lineManager] = await db.select().from(users).where(eq(users.id, user.managerId)).limit(1);
    if (!lineManager) {
      throw new HttpError(422, "Configured Line Manager could not be found.");
    }

    const departmentHeadId = lineManager.managerId;
    if (!departmentHeadId) {
      throw new HttpError(422, "Your Line Manager has no Department Head configured. Contact an administrator.");
    }

    const [financeController] = await db
      .select()
      .from(users)
      .where(and(eq(users.role, "FINANCE_CONTROLLER"), eq(users.active, true)))
      .limit(1);
    if (!financeController) {
      throw new HttpError(422, "No active Finance Controller is configured in the system.");
    }

    const created = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(budgetRequests)
        .values({
          requestNumber: `PENDING-${Date.now()}`, // placeholder, replaced below once we have the id
          projectName: body.projectName,
          costCenterId: body.costCenterId,
          glAccountId: body.glAccountId,
          amount: body.amount.toFixed(2),
          currency: body.currency,
          justification: body.justification,
          assetClass: body.assetClass,
          requestorId: user.id,
          lineManagerId: lineManager.id,
          departmentHeadId,
          financeControllerId: financeController.id,
          status: "PENDING_LINE_MANAGER",
        })
        .returning();

      const requestNumber = `BR-${fiscalYear}-${String(inserted.id).padStart(5, "0")}`;
      const [updated] = await tx
        .update(budgetRequests)
        .set({ requestNumber })
        .where(eq(budgetRequests.id, inserted.id))
        .returning();

      const approverByRole = {
        LINE_MANAGER: lineManager.id,
        DEPARTMENT_HEAD: departmentHeadId,
        FINANCE_CONTROLLER: financeController.id,
      } as const;

      await tx.insert(approvalSteps).values(
        APPROVAL_CHAIN.map((step) => ({
          budgetRequestId: updated.id,
          stepOrder: step.stepOrder,
          approverRole: step.role,
          approverId: approverByRole[step.role as keyof typeof approverByRole],
          status: "PENDING" as const,
        })),
      );

      return updated;
    });

    await recordAuditLog({
      entityType: "BUDGET_REQUEST",
      entityId: created.id,
      action: "SUBMITTED",
      actorId: user.id,
      actorRole: user.role,
      fromStatus: "DRAFT",
      toStatus: "PENDING_LINE_MANAGER",
      comments: `Submitted by ${user.name} for ${body.amount} ${body.currency}.`,
      ipAddress: req.headers.get("x-forwarded-for"),
    });

    return NextResponse.json({ budgetRequest: created }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
