import { NextResponse } from "next/server";
import { db } from "@/db/client";
import {
  approvalSteps,
  budgetRequests,
  clarifications,
  costCenters,
  glAccounts,
  sapIntegrationLogs,
  users,
} from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireAuthedUser, handleApiError, HttpError } from "@/lib/api-helpers";
import { hasPermission } from "@/lib/rbac";

export async function getBudgetRequestDetail(id: number) {
  const [request] = await db.select().from(budgetRequests).where(eq(budgetRequests.id, id)).limit(1);
  if (!request) return null;

  const [steps, clarificationThread, sapLogs, costCenter, glAccount, requestor] = await Promise.all([
    db.select().from(approvalSteps).where(eq(approvalSteps.budgetRequestId, id)).orderBy(asc(approvalSteps.stepOrder)),
    db
      .select()
      .from(clarifications)
      .where(eq(clarifications.budgetRequestId, id))
      .orderBy(asc(clarifications.requestedAt)),
    db
      .select()
      .from(sapIntegrationLogs)
      .where(eq(sapIntegrationLogs.budgetRequestId, id))
      .orderBy(asc(sapIntegrationLogs.startedAt)),
    db.select().from(costCenters).where(eq(costCenters.id, request.costCenterId)).limit(1),
    db.select().from(glAccounts).where(eq(glAccounts.id, request.glAccountId)).limit(1),
    db.select().from(users).where(eq(users.id, request.requestorId)).limit(1),
  ]);

  // Resolve approver names for display.
  const approverIds = [
    request.lineManagerId,
    request.departmentHeadId,
    request.financeControllerId,
  ].filter((v): v is number => v != null);
  const allApprovers = await Promise.all(
    [...new Set(approverIds)].map((uid) => db.select().from(users).where(eq(users.id, uid)).limit(1)),
  );
  const approverMap = Object.fromEntries(allApprovers.filter((a) => a[0]).map((a) => [a[0].id, a[0]]));

  return {
    request,
    costCenter: costCenter[0] ?? null,
    glAccount: glAccount[0] ?? null,
    requestor: requestor[0] ?? null,
    approvalSteps: steps.map((s) => ({ ...s, approver: s.approverId ? approverMap[s.approverId] ?? null : null })),
    clarifications: clarificationThread,
    sapLogs,
  };
}

function canView(
  user: { id: number; role: string },
  request: { requestorId: number; lineManagerId: number | null; departmentHeadId: number | null; financeControllerId: number | null },
) {
  if (hasPermission(user.role as never, "budget:view:all")) return true;
  return (
    request.requestorId === user.id ||
    request.lineManagerId === user.id ||
    request.departmentHeadId === user.id ||
    request.financeControllerId === user.id
  );
}

export async function GET(_req: Request, ctx: RouteContext<"/api/budget-requests/[id]">) {
  try {
    const user = await requireAuthedUser();
    const { id } = await ctx.params;
    const detail = await getBudgetRequestDetail(Number(id));
    if (!detail) throw new HttpError(404, "Budget request not found.");
    if (!canView(user, detail.request)) throw new HttpError(403, "You cannot view this request.");
    return NextResponse.json(detail);
  } catch (err) {
    return handleApiError(err);
  }
}
