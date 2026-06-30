# City Cement — Budget Approval App

A decoupled web application that lets business users initiate and approve
CapEx budget requests, then automatically creates the corresponding Asset
Under Construction (AUC) Internal Order in SAP S/4HANA once a request clears
the full approval chain (Line Manager → Department Head → Finance
Controller).

See `docs/architecture.md` for the full system diagram and state machine,
`docs/api.md` for endpoint-level API documentation, `db/schema.sql` for the
raw SQL schema, and `src/lib/sap/rfc-client.ts` for the SAP RFC integration
design and pseudo-code.

## Getting started

Prerequisites: Node 20+, a PostgreSQL 16 instance.

```bash
npm install
cp .env.example .env   # then fill in DATABASE_URL, SESSION_SECRET, SAP_* vars
npx drizzle-kit push   # creates the schema from src/db/schema.ts
npx tsx src/db/seed.ts # seeds demo cost centers, GL accounts, fiscal limits, and a 9-person org chart
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The login page lists
the seeded demo users (Requestor → Line Manager → Department Head → Finance
Controller → Admin, across two departments) — click one to sign in, no
password required in demo mode.

By default `SAP_MOCK_MODE=true`, so final approvals simulate the SAP RFC
call (realistic latency, occasional injected failure) without needing a real
SAP connection. Set `SAP_MOCK_INJECT_FAILURE=true` to exercise the
`SAP_FAILED` / retry path on demand.

### Other scripts

```bash
npm run build     # production build
npm run lint      # eslint
npx tsc --noEmit  # typecheck
```

## Architecture summary

Next.js (App Router) serves both the UI and the API routes; every request a
business user makes is staged in PostgreSQL — fully ACID — before anything
reaches SAP. A formal state machine (`src/lib/state-machine.ts`) is the only
place that knows which status transitions are legal, so `budget_requests`
can never drift into an invalid state. The final Finance Controller approval
fires an async, fire-and-forget call into the SAP integration module
(`src/lib/sap/`), with the UI polling for `SAP_PROCESSING → SAP_COMPLETED /
SAP_FAILED` resolution rather than blocking the approver's request on SAP
latency. Full detail and diagrams: `docs/architecture.md`.

## Strategic implementation advice

### 1. Build vs. Power Platform

This is built as a custom Next.js app with a thin, swappable API layer
rather than on Microsoft Power Platform (Power Apps + Power Automate). For a
workflow this specific — a fixed three-stage approval chain that must
**provably** never skip a stage, with a hard ACID dependency between
"approved" and "posted to SAP" — Power Platform trades implementation speed
for two things City Cement's controls team will care about:

- **Auditability of the workflow engine itself.** A custom state machine
  (`src/lib/state-machine.ts`) is code that can be reviewed, unit-tested, and
  diffed in a PR — the exact transition table is `APPROVAL_CHAIN`, in one
  file. A Power Automate flow's branching logic lives in a low-code canvas
  that's harder to put under the same kind of change control an internal
  audit function expects for SOX/CapEx-governance-relevant logic.
- **Transactional staging before the SAP write.** The requirement that an
  approval can never be "half-posted" even if the process crashes mid-write
  needs a real transactional database in the write path
  (`db.transaction(...)` in `applyApprovalDecision`), not a flow connector
  retry policy.

The API routes are intentionally the *only* thing touching both Postgres and
the SAP RFC layer (`src/app/api/budget-requests/**`, `src/lib/sap/**`) —
this is what makes it possible to put a real API Gateway in front of this
service later (rate limiting, mTLS to the SAP landscape, centralized auth)
without touching any workflow logic, if/when this needs to be exposed beyond
this one Next.js deployment. Power Platform would still be the right call
for lower-stakes, frequently-changing internal forms where business users
need to self-serve workflow changes without a dev cycle — just not this one.

### 2. Asset Class correctness is the single highest-risk field

`assetClass` (`AUC-PLANT`, `AUC-IT`, `AUC-BUILD`, `AUC-VEHICLE` —
`src/app/requests/new/page.tsx`) is passed straight through to `IV_ANLKL` in
the `Z_BUDGET_APP_CREATE_AUC_IO` RFC call (`src/lib/sap/rfc-client.ts`).
This single field determines the Fixed Asset class the AUC will settle into
at capitalization — get it wrong here and the error isn't visible until
*settlement*, months later, by which point the depreciation schedule,
useful-life assumptions, and tax treatment for that asset may already be
wrong, and correcting it means a manual SAP asset class transfer
(AS01/ABUMN) rather than a form edit.

Two things in this codebase exist specifically to reduce that risk:

- GL accounts carry a `defaultAssetClass` (`src/db/schema.ts`,
  `gl_accounts` table) that auto-fills `assetClass` when a requestor picks a
  GL account (`onGlAccountChange` in `src/app/requests/new/page.tsx`) — the
  requestor can still override it, but the default steers them toward the
  class Finance has already mapped to that GL account.
- `assetClass` is captured once, at submission, and is immutable through the
  rest of the approval chain — Department Head and Finance Controller see it
  on every review screen and can reject/request-clarification if it looks
  wrong, but it can't silently change between submission and the SAP call.

Recommended follow-up outside this app's scope: have Finance periodically
reconcile the `gl_accounts.default_asset_class` mapping against the actual
SAP asset class master so the default stays correct as the chart of accounts
evolves.

### 3. Auditability and the digital signature

Every status-changing action — submit, approve, reject, request
clarification, respond to clarification, SAP posting result — writes a row
to `audit_logs` (`src/lib/audit.ts`) carrying `actorId`, `actorRole`,
`fromStatus`, `toStatus`, `comments`, and a **digital signature**:

```
sha256(actorId | timestamp | entityId | action)
```

The same signature is also stored on the `approval_steps` row for that
decision. Because the signature is a deterministic hash of who acted, when,
on what, and what action they took, it lets an internal or external auditor
cross-reference a CapEx approval against the company's separate identity/SSO
audit logs (e.g. "did this user actually have an active session at this
timestamp") without trusting the application's own database as the sole
source of truth — if the two logs disagree, that's a red flag rather than
something only this app can self-report. `GET
/api/budget-requests/[id]/audit-trail` (restricted to the requestor, the
assigned approvers, and `audit:view`/`budget:view:all` roles — Finance
Controller and Admin) exposes the full trail for review.

## Auth

Demo mode uses a signed-cookie session traded for a `userId` at
`POST /api/auth/login` (`src/app/api/auth/login/route.ts`) — no password,
by design, since this is a demo of the workflow rather than of
authentication. Production replaces this one route with an Azure AD / SSO
callback; every other route depends only on `getCurrentUser()`
(`src/lib/session.ts`), so swapping the identity provider doesn't touch any
workflow or RBAC logic.
