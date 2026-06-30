import { db } from "@/db/client";
import { budgetRequests, costCenters, glAccounts, sapIntegrationLogs, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { recordAuditLog } from "@/lib/audit";
import { createInternalOrder } from "./rfc-client";
import { SapConnectionTimeoutError, SapRfcApplicationError } from "./types";

/**
 * Triggered automatically the moment a budget request reaches APPROVED
 * (final Finance/Budget Controller sign-off). Moves the request through
 * SAP_PROCESSING -> SAP_COMPLETED | SAP_FAILED, persisting one
 * sap_integration_logs row per attempt and writing an audit log entry for
 * the outcome.
 *
 * Called fire-and-forget from the approve route so the HTTP response to
 * the approver isn't blocked on SAP latency; the requestor/approvers see
 * the live status on the request detail page, which polls
 * GET /api/budget-requests/:id.
 */
export async function processApprovedBudget(budgetRequestId: number) {
  const [request] = await db
    .select()
    .from(budgetRequests)
    .where(eq(budgetRequests.id, budgetRequestId))
    .limit(1);

  if (!request || request.status !== "APPROVED") {
    return; // already processed or no longer in a postable state
  }

  await db
    .update(budgetRequests)
    .set({ status: "SAP_PROCESSING", sapPostingStatus: "PENDING", updatedAt: new Date() })
    .where(eq(budgetRequests.id, budgetRequestId));

  const [costCenter] = await db.select().from(costCenters).where(eq(costCenters.id, request.costCenterId)).limit(1);
  const [glAccount] = await db.select().from(glAccounts).where(eq(glAccounts.id, request.glAccountId)).limit(1);
  const [requestor] = await db.select().from(users).where(eq(users.id, request.requestorId)).limit(1);

  if (!costCenter || !glAccount || !requestor) {
    await markFailed(budgetRequestId, "Missing master data (cost center / GL account / requestor).", 0);
    return;
  }

  const rfcFunctionName = "Z_BUDGET_APP_CREATE_AUC_IO";
  const requestPayload = {
    externalReferenceId: request.requestNumber,
    companyCode: process.env.SAP_COMPANY_CODE ?? "1000",
    controllingArea: process.env.SAP_CONTROLLING_AREA ?? "1000",
    costCenter: costCenter.code,
    orderType: process.env.SAP_ORDER_TYPE ?? "IM01",
    description: request.projectName.slice(0, 40), // SAP short-text field limit
    assetClass: request.assetClass,
    plant: costCenter.plant ?? undefined,
    totalBudget: { amount: request.amount, currency: request.currency },
    requestedBy: { employeeId: requestor.employeeId, name: requestor.name },
    glAccount: glAccount.code,
  };

  const [log] = await db
    .insert(sapIntegrationLogs)
    .values({
      budgetRequestId,
      attemptNumber: 1,
      rfcFunctionName,
      requestPayload,
      status: "RETRYING",
    })
    .returning();

  const startedAt = Date.now();
  try {
    const { response, attempts } = await createInternalOrder(requestPayload);
    const durationMs = Date.now() - startedAt;

    await db
      .update(sapIntegrationLogs)
      .set({
        attemptNumber: attempts,
        responsePayload: response,
        status: "SUCCESS",
        completedAt: new Date(),
        durationMs,
      })
      .where(eq(sapIntegrationLogs.id, log.id));

    await db
      .update(budgetRequests)
      .set({
        status: "SAP_COMPLETED",
        sapInternalOrderNumber: response.internalOrderNumber,
        sapPostingStatus: "SUCCESS",
        sapPostedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(budgetRequests.id, budgetRequestId));

    await recordAuditLog({
      entityType: "BUDGET_REQUEST",
      entityId: budgetRequestId,
      action: "SAP_IO_CREATED",
      actorId: null,
      actorRole: null,
      fromStatus: "SAP_PROCESSING",
      toStatus: "SAP_COMPLETED",
      comments: `Internal Order ${response.internalOrderNumber} created (AUC asset ${response.aucAssetNumber}, class ${response.assetClass}).`,
      metadata: { ...response, rfcFunctionName, attempts },
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = describeSapError(err);

    await db
      .update(sapIntegrationLogs)
      .set({
        status: err instanceof SapConnectionTimeoutError ? "TIMEOUT" : "FAILED",
        errorMessage: message,
        completedAt: new Date(),
        durationMs,
      })
      .where(eq(sapIntegrationLogs.id, log.id));

    await markFailed(budgetRequestId, message, durationMs);
  }
}

async function markFailed(budgetRequestId: number, message: string, durationMs: number) {
  await db
    .update(budgetRequests)
    .set({ status: "SAP_FAILED", sapPostingStatus: "FAILED", updatedAt: new Date() })
    .where(eq(budgetRequests.id, budgetRequestId));

  await recordAuditLog({
    entityType: "BUDGET_REQUEST",
    entityId: budgetRequestId,
    action: "SAP_IO_CREATION_FAILED",
    actorId: null,
    actorRole: null,
    fromStatus: "SAP_PROCESSING",
    toStatus: "SAP_FAILED",
    comments: message,
    metadata: { durationMs },
  });
}

function describeSapError(err: unknown): string {
  if (err instanceof SapConnectionTimeoutError) {
    return `SAP connection timeout after ${err.attemptNumber} attempt(s): ${err.message}`;
  }
  if (err instanceof SapRfcApplicationError) {
    return `SAP rejected the posting: ${err.message}`;
  }
  return err instanceof Error ? err.message : "Unknown SAP integration error.";
}

/** Manual retry entry point, e.g. from an admin "Retry SAP posting" action. */
export async function retrySapPosting(budgetRequestId: number) {
  const [request] = await db
    .select()
    .from(budgetRequests)
    .where(eq(budgetRequests.id, budgetRequestId))
    .limit(1);

  if (!request || request.status !== "SAP_FAILED") {
    throw new Error("Only requests in SAP_FAILED status can be retried.");
  }

  await db
    .update(budgetRequests)
    .set({ status: "APPROVED", updatedAt: new Date() })
    .where(eq(budgetRequests.id, budgetRequestId));

  await processApprovedBudget(budgetRequestId);
}
