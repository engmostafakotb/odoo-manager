import { cookies } from "next/headers";
import crypto from "node:crypto";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

const COOKIE_NAME = "budget_app_session";
const secret = process.env.SESSION_SECRET ?? "dev-only-secret-change-me";

/**
 * Demo authentication: the cookie holds a signed user id. In production this
 * is replaced by Azure AD / SSO (see README "Strategic Implementation
 * Advice") and the session would carry a verified AD object id instead of a
 * raw integer - the RBAC and audit logic below is unaffected either way.
 */
function sign(userId: number): string {
  const hmac = crypto.createHmac("sha256", secret).update(String(userId)).digest("hex");
  return `${userId}.${hmac}`;
}

function verify(token: string): number | null {
  const [idPart, mac] = token.split(".");
  if (!idPart || !mac) return null;
  const expected = crypto.createHmac("sha256", secret).update(idPart).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return Number(idPart);
}

export async function setSessionUser(userId: number) {
  const store = await cookies();
  store.set(COOKIE_NAME, sign(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getCurrentUser() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const userId = verify(token);
  if (!userId) return null;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("UNAUTHENTICATED");
  }
  return user;
}
