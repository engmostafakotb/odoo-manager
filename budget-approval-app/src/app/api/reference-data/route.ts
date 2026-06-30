import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { costCenters, glAccounts, fiscalLimits } from "@/db/schema";

/** Cost centers, GL accounts and fiscal limits, for populating the new-request form. */
export async function GET() {
  const [centers, accounts, limits] = await Promise.all([
    db.select().from(costCenters),
    db.select().from(glAccounts),
    db.select().from(fiscalLimits),
  ]);

  return NextResponse.json({ costCenters: centers, glAccounts: accounts, fiscalLimits: limits });
}
