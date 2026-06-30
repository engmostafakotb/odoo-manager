import { NextResponse } from "next/server";
import { requireAuthedUser, handleApiError, HttpError } from "@/lib/api-helpers";
import { requirePermission } from "@/lib/rbac";
import { retrySapPosting } from "@/lib/sap/process-approved-budget";

/** Manual retry for a request stuck in SAP_FAILED (e.g. after a connection timeout). */
export async function POST(_req: Request, ctx: RouteContext<"/api/budget-requests/[id]/retry-sap">) {
  try {
    const actor = await requireAuthedUser();
    requirePermission(actor.role, "admin:manage-users"); // Admin/Finance-ops only
    const { id } = await ctx.params;
    await retrySapPosting(Number(id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
