import { NextResponse } from "next/server";
import { requireAuthedUser, handleApiError } from "@/lib/api-helpers";
import { applyApprovalDecision } from "@/lib/approval-actions";

export async function POST(req: Request, ctx: RouteContext<"/api/budget-requests/[id]/reject">) {
  try {
    const actor = await requireAuthedUser();
    const { id } = await ctx.params;
    const body = await req.json();
    const result = await applyApprovalDecision({
      requestId: Number(id),
      actor,
      action: "REJECT",
      comments: body.comments,
      ipAddress: req.headers.get("x-forwarded-for"),
    });
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
