import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { auditLogs, budgetRequests } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireAuthedUser, handleApiError, HttpError } from "@/lib/api-helpers";
import { hasPermission } from "@/lib/rbac";

export async function GET(_req: Request, ctx: RouteContext<"/api/budget-requests/[id]/audit-trail">) {
  try {
    const user = await requireAuthedUser();
    const { id } = await ctx.params;
    const requestId = Number(id);

    const [request] = await db.select().from(budgetRequests).where(eq(budgetRequests.id, requestId)).limit(1);
    if (!request) throw new HttpError(404, "Budget request not found.");

    const canView =
      hasPermission(user.role, "audit:view") ||
      hasPermission(user.role, "budget:view:all") ||
      request.requestorId === user.id ||
      request.lineManagerId === user.id ||
      request.departmentHeadId === user.id ||
      request.financeControllerId === user.id;
    if (!canView) throw new HttpError(403, "You cannot view this audit trail.");

    const entries = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, requestId))
      .orderBy(asc(auditLogs.createdAt));

    return NextResponse.json({ auditTrail: entries.filter((e) => e.entityType === "BUDGET_REQUEST") });
  } catch (err) {
    return handleApiError(err);
  }
}
