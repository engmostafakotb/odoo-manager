import { z } from "zod";
import { db } from "@/db/client";
import { fiscalLimits, budgetRequests } from "@/db/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";

export const createBudgetRequestSchema = z.object({
  projectName: z.string().trim().min(3).max(200),
  costCenterId: z.number().int().positive(),
  glAccountId: z.number().int().positive(),
  amount: z.number().positive().max(999_999_999.99),
  currency: z.string().length(3).default("EGP"),
  justification: z.string().trim().min(20, "Justification must be at least 20 characters."),
  assetClass: z.string().trim().min(2).max(20),
});

export type CreateBudgetRequestInput = z.infer<typeof createBudgetRequestSchema>;

export class FiscalLimitError extends Error {}

/**
 * Server-side validation: the request must not exceed the pre-defined
 * fiscal limit for its cost center / GL account / fiscal year, either as a
 * single request or cumulatively for the year. This runs again on the
 * server even though the client should also warn the user early - never
 * trust client-side validation alone for a CapEx control.
 */
export async function validateAgainstFiscalLimits(input: {
  costCenterId: number;
  glAccountId: number;
  amount: number;
  fiscalYear: number;
}) {
  const [limit] = await db
    .select()
    .from(fiscalLimits)
    .where(
      and(
        eq(fiscalLimits.costCenterId, input.costCenterId),
        eq(fiscalLimits.glAccountId, input.glAccountId),
        eq(fiscalLimits.fiscalYear, input.fiscalYear),
      ),
    )
    .limit(1);

  if (!limit) {
    throw new FiscalLimitError(
      `No fiscal limit is configured for this cost center / GL account / FY${input.fiscalYear}. ` +
        `Contact Finance to set one up before submitting.`,
    );
  }

  if (input.amount > Number(limit.maxSingleRequestAmount)) {
    throw new FiscalLimitError(
      `Amount ${input.amount} exceeds the maximum single-request limit of ` +
        `${limit.maxSingleRequestAmount} ${limit.currency} for this cost center.`,
    );
  }

  const yearStart = new Date(Date.UTC(input.fiscalYear, 0, 1));
  const yearEnd = new Date(Date.UTC(input.fiscalYear + 1, 0, 1));

  const [{ total }] = await db
    .select({ total: sql<string>`coalesce(sum(${budgetRequests.amount}), 0)` })
    .from(budgetRequests)
    .where(
      and(
        eq(budgetRequests.costCenterId, input.costCenterId),
        eq(budgetRequests.glAccountId, input.glAccountId),
        gte(budgetRequests.createdAt, yearStart),
        lte(budgetRequests.createdAt, yearEnd),
        sql`${budgetRequests.status} NOT IN ('REJECTED', 'CANCELLED')`,
      ),
    );

  const projectedTotal = Number(total) + input.amount;
  if (projectedTotal > Number(limit.maxAnnualAmount)) {
    throw new FiscalLimitError(
      `This request would bring FY${input.fiscalYear} spend for this cost center / GL account to ` +
        `${projectedTotal.toFixed(2)} ${limit.currency}, exceeding the annual limit of ` +
        `${limit.maxAnnualAmount} ${limit.currency}.`,
    );
  }

  return limit;
}
