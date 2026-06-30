/**
 * Wire types for the SAP RFC integration. These mirror the import/export
 * parameters of the custom RFC-enabled function module
 * `Z_BUDGET_APP_CREATE_AUC_IO`, which on the SAP side wraps:
 *   1. BAPI_INTERNALORDER_CREATE   - creates the Internal Order (order type
 *      configured as an "Investment Measure" category, e.g. order type 'IM01')
 *   2. BAPI_INTERNALORDER_SETTLE-style settlement rule maintenance, pointing
 *      the IO's settlement receiver at the AUC asset class so the eventual
 *      capitalization run (AIAB/AIBU) posts to a Fixed Asset, not OPEX.
 *   3. BAPI_TRANSACTION_COMMIT     - commits both in a single LUW so the IO
 *      is never left without a settlement rule.
 *
 * Bundling these into one custom Z-RFC (rather than three separate BAPI
 * calls from Node) keeps the multi-step SAP-side transaction atomic and
 * gives us a single timeout/retry boundary to manage from the integration
 * layer.
 */

export interface CreateInternalOrderRequest {
  /** Our staging DB's budget_requests.request_number, for SAP-side idempotency. */
  externalReferenceId: string;
  companyCode: string;
  controllingArea: string;
  costCenter: string;
  /** SAP order type for investment-measure orders that settle to AUC, e.g. "IM01". */
  orderType: string;
  description: string;
  /**
   * Asset class the order will settle to once capitalized (AIAB/AIBU).
   * Must exist in SAP asset accounting (e.g. "AUC-PLANT", "AUC-IT",
   * "AUC-MACHINERY") - getting this wrong means the project capitalizes
   * to the wrong depreciation area / useful life.
   */
  assetClass: string;
  plant?: string;
  totalBudget: { amount: string; currency: string };
  requestedBy: { employeeId: string; name: string };
  glAccount: string;
}

export interface CreateInternalOrderResponse {
  internalOrderNumber: string;
  /** Asset Under Construction master record number created alongside the IO. */
  aucAssetNumber: string;
  assetClass: string;
  budgetPostedAmount: string;
  currency: string;
  sapDocumentDate: string;
}

export interface SapRfcErrorPayload {
  /** SAP "return" structure style code, e.g. E (error), W (warning). */
  type: "E" | "W" | "A";
  /** Standard SAP message id/number, e.g. "ZBUDGET" / "001". */
  messageClass: string;
  messageNumber: string;
  message: string;
}

export class SapConnectionTimeoutError extends Error {
  constructor(public readonly attemptNumber: number, public readonly timeoutMs: number) {
    super(`SAP RFC call timed out after ${timeoutMs}ms (attempt ${attemptNumber}).`);
    this.name = "SapConnectionTimeoutError";
  }
}

export class SapRfcApplicationError extends Error {
  constructor(public readonly sapError: SapRfcErrorPayload) {
    super(`SAP RFC returned ${sapError.type} ${sapError.messageClass}${sapError.messageNumber}: ${sapError.message}`);
    this.name = "SapRfcApplicationError";
  }
}
