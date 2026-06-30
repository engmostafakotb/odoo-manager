import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setSessionUser } from "@/lib/session";
import { handleApiError, HttpError } from "@/lib/api-helpers";

/**
 * Demo-mode login: trades a userId for a session cookie. Production
 * replaces this route with an Azure AD / SSO callback (see README) - every
 * other route only depends on `getCurrentUser()`, so swapping the identity
 * provider does not touch the workflow logic.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    const [user] = await db.select().from(users).where(eq(users.id, Number(userId))).limit(1);
    if (!user || !user.active) {
      throw new HttpError(401, "Unknown or inactive user.");
    }
    await setSessionUser(user.id);
    return NextResponse.json({ user });
  } catch (err) {
    return handleApiError(err);
  }
}
