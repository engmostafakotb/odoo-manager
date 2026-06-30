import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { asc } from "drizzle-orm";

/** Used by the demo login picker and by "assign approver" UI. */
export async function GET() {
  const all = await db.select().from(users).orderBy(asc(users.role), asc(users.name));
  return NextResponse.json({ users: all });
}
