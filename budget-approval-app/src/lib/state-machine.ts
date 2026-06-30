/**
 * Formal state machine for the budget approval workflow.
 *
 * This is the single source of truth for which transitions are legal, who
 * is allowed to trigger them, and what side effects they imply. API routes
 * MUST go through `transition()` rather than writing `status` directly -
 * that's what guarantees the data in `budget_requests` is always
 * consistent with a reachable state in this graph.
 *
 *                                    ┌───────────────────────┐
 *                                    │   CLARIFICATION_       │
 *                              ┌────▶│   REQUESTED            │────┐
 *                              │     └───────────────────────┘    │ (requestor responds,
 *   submit                    │ request                          │  returns to the step
 * DRAFT ──────▶ PENDING_LINE_MANAGER │  clarification            │  that asked)
 *                  │   │       │                                  │
 *        reject ───┘   │ approve                                  │
 *                       ▼                                         │
 *              PENDING_DEPARTMENT_HEAD ─────────────────────────────┘
 *                  │   │
 *        reject ───┘   │ approve
 *                       ▼
 *                 PENDING_FINANCE
 *                  │   │
 *        reject ───┘   │ approve
 *                       ▼
 *                   APPROVED ──(system, automatic)──▶ SAP_PROCESSING
 *                                                          │   │
 *                                                  success │   │ failure (after retries)
 *                                                          ▼   ▼
 *                                                SAP_COMPLETED  SAP_FAILED ──(retry)──▶ SAP_PROCESSING
 *
 * REJECTED, SAP_COMPLETED and CANCELLED are terminal states.
 */

import type { budgetStatusEnum, userRoleEnum } from "@/db/schema";

export type BudgetStatus = (typeof budgetStatusEnum.enumValues)[number];
export type UserRole = (typeof userRoleEnum.enumValues)[number];

export type ApprovalAction = "APPROVE" | "REJECT" | "REQUEST_CLARIFICATION";

/** The three sequential human approval stages, in order. */
export const APPROVAL_CHAIN: { stepOrder: number; role: UserRole; status: BudgetStatus }[] = [
  { stepOrder: 1, role: "LINE_MANAGER", status: "PENDING_LINE_MANAGER" },
  { stepOrder: 2, role: "DEPARTMENT_HEAD", status: "PENDING_DEPARTMENT_HEAD" },
  { stepOrder: 3, role: "FINANCE_CONTROLLER", status: "PENDING_FINANCE" },
];

export const TERMINAL_STATES: BudgetStatus[] = ["REJECTED", "SAP_COMPLETED", "CANCELLED"];

/**
 * Map of status -> role allowed to act on a PENDING_* status. Used to
 * authorize approve/reject/clarify requests.
 */
const APPROVER_ROLE_FOR_STATUS: Partial<Record<BudgetStatus, UserRole>> = {
  PENDING_LINE_MANAGER: "LINE_MANAGER",
  PENDING_DEPARTMENT_HEAD: "DEPARTMENT_HEAD",
  PENDING_FINANCE: "FINANCE_CONTROLLER",
};

export function approverRoleForStatus(status: BudgetStatus): UserRole | undefined {
  return APPROVER_ROLE_FOR_STATUS[status];
}

export function isTerminal(status: BudgetStatus): boolean {
  return TERMINAL_STATES.includes(status);
}

export function nextApprovalStatus(currentStatus: BudgetStatus): BudgetStatus {
  const idx = APPROVAL_CHAIN.findIndex((s) => s.status === currentStatus);
  if (idx === -1) {
    throw new Error(`${currentStatus} is not a pending-approval status`);
  }
  const next = APPROVAL_CHAIN[idx + 1];
  return next ? next.status : "APPROVED";
}

/**
 * Validates whether `action` is legal from `currentStatus`, and returns the
 * resulting status. Throws a StateMachineError if not allowed - callers
 * (API routes) should catch this and return 409 Conflict.
 */
export class StateMachineError extends Error {}

export function applyApprovalAction(currentStatus: BudgetStatus, action: ApprovalAction): BudgetStatus {
  if (!(currentStatus in APPROVER_ROLE_FOR_STATUS)) {
    throw new StateMachineError(
      `Cannot ${action} a request in status ${currentStatus}: it is not awaiting approval.`,
    );
  }

  switch (action) {
    case "APPROVE":
      return nextApprovalStatus(currentStatus);
    case "REJECT":
      return "REJECTED";
    case "REQUEST_CLARIFICATION":
      return "CLARIFICATION_REQUESTED";
    default:
      throw new StateMachineError(`Unknown action ${action}`);
  }
}

/**
 * When the requestor answers a clarification, the request returns to
 * whichever pending-approval status it was in before the question was
 * raised (stored on the clarification's approval step).
 */
export function resumeAfterClarification(steppedFromStatus: BudgetStatus): BudgetStatus {
  if (!(steppedFromStatus in APPROVER_ROLE_FOR_STATUS)) {
    throw new StateMachineError(`Cannot resume into non-approval status ${steppedFromStatus}`);
  }
  return steppedFromStatus;
}

export function canTransitionToSapProcessing(status: BudgetStatus): boolean {
  return status === "APPROVED" || status === "SAP_FAILED";
}
