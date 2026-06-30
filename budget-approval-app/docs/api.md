# API Documentation — Budget Approval Flow

All routes are Next.js Route Handlers under `src/app/api/`. Every route (except
`auth/login`) requires a valid session cookie; `requireAuthedUser()` rejects
unauthenticated requests with `401` before any handler logic runs.

## Conventions

- **Auth**: signed-cookie session (`getCurrentUser()` in `src/lib/session.ts`).
  Demo mode trades a `userId` for a cookie via `POST /api/auth/login`;
  production swaps this one file for an Azure AD / SSO callback.
- **RBAC**: each mutating route calls `requirePermission(role, permission)`
  (`src/lib/rbac.ts`) before touching data. The permission map is reproduced
  below.
- **Errors**: every route funnels through `handleApiError()`
  (`src/lib/api-helpers.ts`), which maps thrown errors to a JSON body
  `{ "error": string }` (plus `details` for validation errors) and an HTTP
  status:

  | Error type | Status | Cause |
  |---|---|---|
  | not authenticated | 401 | missing/invalid session cookie |
  | `ForbiddenError` | 403 | role lacks the required permission, or actor is not the assigned approver for this request |
  | `HttpError(404, ...)` | 404 | request / step / clarification not found |
  | `StateMachineError` | 409 | the action is not a legal transition from the request's current status |
  | `HttpError(409, ...)` | 409 | request is not currently awaiting the action being attempted |
  | `FiscalLimitError` | 422 | amount exceeds the configured fiscal limit for the cost center / GL account |
  | `HttpError(422, ...)` | 422 | requestor's approval chain can't be resolved (missing manager / department head / finance controller) |
  | `ZodError` | 400 | request body fails schema validation |
  | anything else | 500 | unexpected server error (logged server-side) |

### Role permission map (`src/lib/rbac.ts`)

| Permission | REQUESTOR | LINE_MANAGER | DEPARTMENT_HEAD | FINANCE_CONTROLLER | ADMIN |
|---|---|---|---|---|---|
| `budget:create` | ✓ | ✓ | ✓ | | ✓ |
| `budget:view:own` | ✓ | ✓ | ✓ | | ✓ |
| `budget:view:all` | | | ✓ | ✓ | ✓ |
| `budget:approve` / `budget:reject` | | ✓ | ✓ | ✓ | ✓ |
| `budget:request-clarification` | | ✓ | ✓ | ✓ | ✓ |
| `budget:respond-clarification` | ✓ | ✓ | ✓ | | ✓ |
| `budget:cancel` | | | | | ✓ |
| `audit:view` | | | | ✓ | ✓ |
| `admin:manage-users` | | | | | ✓ |

---

## Auth

### `POST /api/auth/login`
Demo-mode login: trades a `userId` for a session cookie.

Request body: `{ "userId": number }`

Response `200`: `{ "user": User }`
Errors: `401` if the user doesn't exist or is inactive.

### `POST /api/auth/logout`
Clears the session cookie. Response `200`: `{ "ok": true }`.

### `GET /api/auth/me`
Returns the current session user, or `{ "user": null }` if unauthenticated
(does not 401 — used by the client to decide whether to redirect to login).

---

## Reference data

### `GET /api/users`
All users, ordered by role then name. Used by the demo login picker.

### `GET /api/reference-data`
Cost centers, GL accounts, and fiscal limits — used to populate the new
budget request form.

Response `200`:
```json
{ "costCenters": [...], "glAccounts": [...], "fiscalLimits": [...] }
```

---

## Budget requests

### `GET /api/budget-requests?scope=mine|pending-my-approval|all`
- `scope=mine` (default): requests created by the current user.
- `scope=pending-my-approval`: requests whose current status puts the ball in
  this user's court (matched against `lineManagerId` / `departmentHeadId` /
  `financeControllerId` for the matching `PENDING_*` status).
- `scope=all`: every request, requires `budget:view:all`
  (Department Head / Finance Controller / Admin).

Response `200`: `{ "budgetRequests": BudgetRequest[] }`

### `POST /api/budget-requests`
Creates a new budget request and the three-step approval chain, then
auto-submits it (`status: PENDING_LINE_MANAGER`). Requires `budget:create`.

The approval chain is derived automatically from the org chart at submit
time, not chosen by the requestor: Line Manager = `requestor.managerId`,
Department Head = the Line Manager's `managerId`, Finance Controller = the
active user with role `FINANCE_CONTROLLER`. A request whose chain can't be
fully resolved (no manager configured, line manager has no department head,
no active finance controller) is rejected with `422` rather than silently
created with a gap.

Request body (validated against `createBudgetRequestSchema`, plus
server-side fiscal-limit check via `validateAgainstFiscalLimits`):
```json
{
  "projectName": "string",
  "costCenterId": number,
  "glAccountId": number,
  "amount": number,
  "currency": "string",
  "assetClass": "AUC-PLANT | AUC-IT | AUC-BUILD | AUC-VEHICLE",
  "justification": "string"
}
```

Response `201`: `{ "budgetRequest": BudgetRequest }`
Errors: `400` (schema), `422` (fiscal limit exceeded, or chain unresolved).

### `GET /api/budget-requests/[id]`
Full detail for one request: the request row, resolved cost center / GL
account / requestor, approval steps (with resolved approver names), the
clarification thread, and SAP integration log entries.

Viewable by: the requestor, any of the three assigned approvers, or anyone
with `budget:view:all`. Otherwise `403`.

---

## Approval decisions

These three routes share `applyApprovalDecision()`
(`src/lib/approval-actions.ts`), the single function that validates the
actor is the *assigned* approver for the request's *current* pending stage,
applies the state-machine transition, signs and records the approval step,
and writes an audit log entry. The "current stage" is resolved by matching
the request's `status` against `APPROVAL_CHAIN`, then loading the
`approval_steps` row at that exact `stepOrder` — not "whichever step is
still PENDING" — since all three steps are inserted as `PENDING` up front
and only converge to the right one this way.

### `POST /api/budget-requests/[id]/approve`
Requires `budget:approve` and that the caller is the assigned approver for
the request's current status. Body: `{ "comments"?: string }`.

On the **final** approval (Finance Controller, `PENDING_FINANCE → APPROVED`),
the response returns immediately and the SAP Internal Order creation is
kicked off fire-and-forget (`void processApprovedBudget(requestId)`); the
request moves to `SAP_PROCESSING` and the client polls
`GET /api/budget-requests/[id]` until it resolves to `SAP_COMPLETED` or
`SAP_FAILED`.

Response `200`: `{ "status": BudgetStatus }`

### `POST /api/budget-requests/[id]/reject`
Requires `budget:reject`. Body: `{ "comments": string }` — **comments are
required**, `400` if blank. Terminal: moves the request to `REJECTED`.

### `POST /api/budget-requests/[id]/request-clarification`
Requires `budget:request-clarification`. Body: `{ "comments": string }` —
required. Moves the request to `CLARIFICATION_REQUESTED` and opens a row in
`clarifications` tied to the current approval step.

### `POST /api/budget-requests/[id]/respond-clarification`
Requires `budget:respond-clarification` and that the caller is the original
requestor. Body: `{ "response": string }` — required, `400` if blank.

Resumes the request at the stage that asked for clarification (resolved from
the open clarification's `approvalStepId` → `stepOrder` → `APPROVAL_CHAIN`),
**not** at the first step — this is what keeps a clarification round-trip
from skipping or repeating an approver in the chain.

Errors: `409` if there's no open (unanswered) clarification on the request.

### `POST /api/budget-requests/[id]/retry-sap`
Requires `admin:manage-users` (Admin only). Re-attempts SAP Internal Order
creation for a request stuck in `SAP_FAILED` (e.g. after a connection
timeout exhausted its retries). Moves the request back to `SAP_PROCESSING`
and re-runs the same RFC call path as the original automatic attempt.

---

## Audit trail

### `GET /api/budget-requests/[id]/audit-trail`
All audit log entries for the request, oldest first, each including
`actorId`, `actorRole`, `fromStatus`, `toStatus`, `comments`, and the
digital signature (`sha256(actorId|timestamp|entityId|action)`).

Viewable by: the requestor, any of the three assigned approvers, or anyone
with `audit:view` / `budget:view:all` (Finance Controller, Admin). Otherwise
`403`.

---

## State machine reference

See `docs/architecture.md` for the full `stateDiagram-v2`. Approve/reject/
request-clarification are only legal from the `PENDING_*` status that
matches the actor's role in the chain; attempting them from any other status
(e.g. double-approving, or approving an already-rejected request) raises a
`StateMachineError` → `409`.
