import { NextResponse } from "next/server";
import { getCurrentUser } from "./session";
import { ForbiddenError } from "./rbac";
import { StateMachineError } from "./state-machine";
import { FiscalLimitError } from "./validation";
import { ZodError } from "zod";

export async function requireAuthedUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new HttpError(401, "Not authenticated. Sign in first.");
  }
  return user;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function handleApiError(err: unknown) {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof StateMachineError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof FiscalLimitError) {
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "Validation failed", details: err.issues }, { status: 400 });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
