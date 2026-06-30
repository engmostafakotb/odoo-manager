/**
 * SAP RFC connector - pseudo-code reference implementation.
 * =========================================================
 *
 * DELIVERABLE: this file is the "pseudo-code for the SAP integration
 * function" requested for the architecture review. It is written as real,
 * runnable TypeScript so it can be exercised end-to-end in this demo, but
 * the `realRfcCall()` path describes - rather than fully reimplements - the
 * SAP-side call: it is gated behind `node-rfc`, the official SAP NetWeaver
 * RFC SDK binding, which requires the proprietary SAP NW RFC SDK to be
 * installed on the host and is therefore not vendored into this repo.
 *
 * In MOCK mode (SAP_MOCK_MODE=true, the default for local dev/demo) calls
 * are simulated with realistic latency and an occasional injected failure
 * so the retry/timeout logic below is genuinely exercised.
 *
 * Production wiring: replace `realRfcCall` with an actual `node-rfc`
 * `Pool`/`Client` invoking the custom Z_BUDGET_APP_CREATE_AUC_IO function
 * module described in ./types.ts. Connection pooling, not a fresh
 * connection per call, is required for production throughput.
 */

import {
  CreateInternalOrderRequest,
  CreateInternalOrderResponse,
  SapConnectionTimeoutError,
  SapRfcApplicationError,
  type SapRfcErrorPayload,
} from "./types";

interface SapConnectionConfig {
  host: string;
  systemNumber: string;
  client: string;
  user: string;
  password: string;
  timeoutMs: number;
  maxRetries: number;
}

function loadConfig(): SapConnectionConfig {
  return {
    host: process.env.SAP_HOST ?? "",
    systemNumber: process.env.SAP_SYSTEM_NUMBER ?? "00",
    client: process.env.SAP_CLIENT ?? "100",
    user: process.env.SAP_RFC_USER ?? "",
    password: process.env.SAP_RFC_PASSWORD ?? "",
    timeoutMs: Number(process.env.SAP_RFC_TIMEOUT_MS ?? 15_000),
    maxRetries: Number(process.env.SAP_RFC_MAX_RETRIES ?? 3),
  };
}

function isMockMode(): boolean {
  return (process.env.SAP_MOCK_MODE ?? "true").toLowerCase() !== "false";
}

/**
 * --- PSEUDO-CODE: the actual SAP-side call -------------------------------
 *
 * async function realRfcCall(config, request) {
 *   // node-rfc connection pool, created once per process and reused -
 *   // opening a fresh ABAP session per request is the #1 cause of RFC
 *   // connection-timeout incidents in production integrations.
 *   const pool = getOrCreateConnectionPool({
 *     ashost: config.host,
 *     sysnr: config.systemNumber,
 *     client: config.client,
 *     user: config.user,
 *     passwd: config.password,
 *     lang: "EN",
 *     rtrim: true,
 *   });
 *
 *   const connection = await pool.acquire();
 *   try {
 *     const result = await connection.call("Z_BUDGET_APP_CREATE_AUC_IO", {
 *       IV_EXTERNAL_REF:   request.externalReferenceId,
 *       IV_BUKRS:          request.companyCode,        // company code
 *       IV_KOKRS:          request.controllingArea,    // controlling area
 *       IV_KOSTL:          request.costCenter,         // cost center
 *       IV_AUART:          request.orderType,          // IM01 (Investment Measure)
 *       IV_KTEXT:          request.description,        // order short text
 *       IV_ANLKL:          request.assetClass,         // AUC asset class
 *       IV_WERKS:          request.plant ?? "",
 *       IV_GSBER:          "",                          // business area, if used
 *       IV_BUDGET_BETRAG:  request.totalBudget.amount,
 *       IV_WAERS:          request.totalBudget.currency,
 *       IV_SAKNR:          request.glAccount,
 *       IV_ANTRAGSTELLER:  request.requestedBy.employeeId,
 *     });
 *
 *     // RFC RETURN structure convention: TYPE 'E'/'A' = hard error.
 *     if (result.ET_RETURN.some(r => ["E", "A"].includes(r.TYPE))) {
 *       const err = result.ET_RETURN.find(r => ["E", "A"].includes(r.TYPE));
 *       throw new SapRfcApplicationError(toErrorPayload(err));
 *     }
 *
 *     return {
 *       internalOrderNumber: result.EV_AUFNR,
 *       aucAssetNumber:      result.EV_ANLN1,
 *       assetClass:          request.assetClass,
 *       budgetPostedAmount:  result.EV_BUDGET_BETRAG,
 *       currency:            request.totalBudget.currency,
 *       sapDocumentDate:     result.EV_BUDAT,
 *     };
 *   } finally {
 *     await pool.release(connection);
 *   }
 * }
 * ---------------------------------------------------------------------- */
async function realRfcCall(
  config: SapConnectionConfig,
  request: CreateInternalOrderRequest,
): Promise<CreateInternalOrderResponse> {
  let nodeRfc: typeof import("node-rfc");
  try {
    // Optional dependency: only required when SAP_MOCK_MODE=false in an
    // environment where the SAP NW RFC SDK is installed.
    nodeRfc = await import("node-rfc");
  } catch {
    throw new Error(
      "SAP_MOCK_MODE is false but the 'node-rfc' package (and the SAP NW RFC SDK) " +
        "is not installed in this environment. Install both, or set SAP_MOCK_MODE=true.",
    );
  }

  const client = new nodeRfc.Client({
    ashost: config.host,
    sysnr: config.systemNumber,
    client: config.client,
    user: config.user,
    passwd: config.password,
    lang: "EN",
  });

  await client.open();
  try {
    const result = await client.call("Z_BUDGET_APP_CREATE_AUC_IO", {
      IV_EXTERNAL_REF: request.externalReferenceId,
      IV_BUKRS: request.companyCode,
      IV_KOKRS: request.controllingArea,
      IV_KOSTL: request.costCenter,
      IV_AUART: request.orderType,
      IV_KTEXT: request.description,
      IV_ANLKL: request.assetClass,
      IV_WERKS: request.plant ?? "",
      IV_BUDGET_BETRAG: request.totalBudget.amount,
      IV_WAERS: request.totalBudget.currency,
      IV_SAKNR: request.glAccount,
      IV_ANTRAGSTELLER: request.requestedBy.employeeId,
    });

    const hardError = (result.ET_RETURN as SapRfcErrorPayload[] | undefined)?.find((r) =>
      ["E", "A"].includes(r.type),
    );
    if (hardError) {
      throw new SapRfcApplicationError(hardError);
    }

    return {
      internalOrderNumber: result.EV_AUFNR,
      aucAssetNumber: result.EV_ANLN1,
      assetClass: request.assetClass,
      budgetPostedAmount: result.EV_BUDGET_BETRAG,
      currency: request.totalBudget.currency,
      sapDocumentDate: result.EV_BUDAT,
    };
  } finally {
    await client.close();
  }
}

/** Deterministic-ish mock used for local dev / demos (SAP_MOCK_MODE=true). */
async function mockRfcCall(request: CreateInternalOrderRequest): Promise<CreateInternalOrderResponse> {
  const latencyMs = 400 + Math.random() * 800;
  await new Promise((resolve) => setTimeout(resolve, latencyMs));

  // Simulate an occasional transient connection failure so the retry path
  // is exercised in demos, without making the workflow flaky in tests.
  if (process.env.SAP_MOCK_INJECT_FAILURE === "true" && Math.random() < 0.3) {
    throw new SapConnectionTimeoutError(1, 15_000);
  }

  const ioNumber = `IO${Date.now().toString().slice(-8)}`;
  const aucAssetNumber = `${request.assetClass.replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase()}-${Math.floor(
    Math.random() * 9000 + 1000,
  )}`;

  return {
    internalOrderNumber: ioNumber,
    aucAssetNumber,
    assetClass: request.assetClass,
    budgetPostedAmount: request.totalBudget.amount,
    currency: request.totalBudget.currency,
    sapDocumentDate: new Date().toISOString().slice(0, 10),
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, attemptNumber: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new SapConnectionTimeoutError(attemptNumber, timeoutMs)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Creates an SAP Internal Order classified as an Asset Under Construction
 * (AUC), linking it to the approved budget amount.
 *
 * Error handling strategy:
 *  - Connection-level failures (timeout, ECONNRESET) ARE retried, with
 *    exponential backoff, up to SAP_RFC_MAX_RETRIES times - these are
 *    transient infrastructure issues.
 *  - Application-level failures (SapRfcApplicationError - e.g. invalid
 *    asset class, cost center locked, budget already posted) are NOT
 *    retried - retrying a logically-rejected posting will not make it
 *    succeed, and may create duplicate IOs if SAP-side idempotency by
 *    externalReferenceId isn't perfectly enforced.
 */
export async function createInternalOrder(
  request: CreateInternalOrderRequest,
): Promise<{ response: CreateInternalOrderResponse; attempts: number }> {
  const config = loadConfig();
  const mock = isMockMode();

  let lastError: unknown;
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const call = mock ? mockRfcCall(request) : realRfcCall(config, request);
      const response = await withTimeout(call, config.timeoutMs, attempt);
      return { response, attempts: attempt };
    } catch (err) {
      lastError = err;

      if (err instanceof SapRfcApplicationError) {
        // Business-rule rejection from SAP - fail fast, do not retry.
        throw err;
      }

      const isLastAttempt = attempt === config.maxRetries;
      if (isLastAttempt) break;

      const backoffMs = 2 ** (attempt - 1) * 1000; // 1s, 2s, 4s, ...
      await sleep(backoffMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("SAP RFC call failed for an unknown reason after all retries.");
}
