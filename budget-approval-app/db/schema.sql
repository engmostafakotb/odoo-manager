-- =============================================================================
-- Budget Approval Application - PostgreSQL DDL
-- City Cement Company
--
-- This is the staging database that sits between business requestors and
-- SAP S/4HANA. Every budget request and every approval-state transition is
-- persisted here (ACID-compliant) BEFORE anything is posted to SAP. Only a
-- fully approved, validated request is ever pushed to SAP via the RFC
-- connector (see src/lib/sap/rfc-client.ts).
--
-- Source of truth: src/db/schema.ts (Drizzle ORM). Regenerate with:
--   npx drizzle-kit generate
-- This file is the human-readable deliverable; it is functionally
-- equivalent to drizzle/0000_*.sql plus the self-referencing FK and the
-- extra indexes called out below.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

CREATE TYPE user_role AS ENUM (
  'REQUESTOR',
  'LINE_MANAGER',
  'DEPARTMENT_HEAD',
  'FINANCE_CONTROLLER',
  'ADMIN'
);

-- Formal state machine for a budget request. See docs/architecture.md for the
-- full transition diagram. Enforced in application code
-- (src/lib/state-machine.ts); the enum guarantees only valid states are ever
-- stored.
CREATE TYPE budget_status AS ENUM (
  'DRAFT',
  'PENDING_LINE_MANAGER',
  'PENDING_DEPARTMENT_HEAD',
  'PENDING_FINANCE',
  'CLARIFICATION_REQUESTED',
  'APPROVED',
  'REJECTED',
  'SAP_PROCESSING',
  'SAP_COMPLETED',
  'SAP_FAILED',
  'CANCELLED'
);

CREATE TYPE approval_step_status AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CLARIFICATION_REQUESTED',
  'SKIPPED'
);

CREATE TYPE sap_log_status AS ENUM (
  'PENDING',
  'SUCCESS',
  'FAILED',
  'TIMEOUT',
  'RETRYING'
);

-- -----------------------------------------------------------------------------
-- Master / reference data
-- -----------------------------------------------------------------------------

CREATE TABLE cost_centers (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(20)  NOT NULL UNIQUE,
  name        VARCHAR(120) NOT NULL,
  department  VARCHAR(120) NOT NULL,
  plant       VARCHAR(60),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE gl_accounts (
  id                   SERIAL PRIMARY KEY,
  code                 VARCHAR(20)  NOT NULL UNIQUE,
  name                 VARCHAR(120) NOT NULL,
  account_type         VARCHAR(20)  NOT NULL,        -- CAPEX | OPEX
  -- Default SAP asset class used when this GL account funds an Asset Under
  -- Construction (AUC). Critical for the downstream settlement run that
  -- capitalizes the project to a Fixed Asset; getting this wrong means the
  -- AUC settles to the wrong asset class.
  default_asset_class  VARCHAR(20),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Server-side validation source: a budget request must not exceed these
-- limits at submission time (enforced in src/lib/validation.ts).
CREATE TABLE fiscal_limits (
  id                          SERIAL PRIMARY KEY,
  cost_center_id              INTEGER NOT NULL REFERENCES cost_centers(id),
  gl_account_id               INTEGER NOT NULL REFERENCES gl_accounts(id),
  fiscal_year                 INTEGER NOT NULL,
  max_single_request_amount   NUMERIC(18,2) NOT NULL,
  max_annual_amount           NUMERIC(18,2) NOT NULL,
  currency                    VARCHAR(3) NOT NULL DEFAULT 'EGP',
  UNIQUE (cost_center_id, gl_account_id, fiscal_year)
);

-- -----------------------------------------------------------------------------
-- Identity (production: synced from Azure AD / SAP HR via SSO - see README)
-- -----------------------------------------------------------------------------

CREATE TABLE users (
  id             SERIAL PRIMARY KEY,
  employee_id    VARCHAR(20)  NOT NULL UNIQUE,
  name           VARCHAR(120) NOT NULL,
  email          VARCHAR(160) NOT NULL UNIQUE,
  role           user_role    NOT NULL,
  department     VARCHAR(120),
  cost_center_id INTEGER REFERENCES cost_centers(id),
  manager_id     INTEGER REFERENCES users(id),
  active         BOOLEAN      NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_manager_id ON users(manager_id);
CREATE INDEX idx_users_role ON users(role);

-- -----------------------------------------------------------------------------
-- Budget request - the staging record before SAP posting
-- -----------------------------------------------------------------------------

CREATE TABLE budget_requests (
  id                       SERIAL PRIMARY KEY,
  request_number           VARCHAR(30) NOT NULL UNIQUE,

  project_name             VARCHAR(200) NOT NULL,
  cost_center_id           INTEGER NOT NULL REFERENCES cost_centers(id),
  gl_account_id            INTEGER NOT NULL REFERENCES gl_accounts(id),
  amount                   NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency                 VARCHAR(3) NOT NULL DEFAULT 'EGP',
  justification            TEXT NOT NULL,

  -- AUC classification carried through to SAP at IO-creation time.
  asset_class              VARCHAR(20) NOT NULL,

  requestor_id             INTEGER NOT NULL REFERENCES users(id),
  line_manager_id          INTEGER REFERENCES users(id),
  department_head_id       INTEGER REFERENCES users(id),
  finance_controller_id    INTEGER REFERENCES users(id),

  status                   budget_status NOT NULL DEFAULT 'DRAFT',

  -- Populated once the SAP Internal Order has been created successfully.
  sap_internal_order_number VARCHAR(20),
  sap_posting_status         sap_log_status,
  sap_posted_at               TIMESTAMPTZ,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_budget_requests_status ON budget_requests(status);
CREATE INDEX idx_budget_requests_requestor ON budget_requests(requestor_id);
CREATE INDEX idx_budget_requests_cost_center ON budget_requests(cost_center_id);

-- -----------------------------------------------------------------------------
-- Approval steps - one row per stage of the sequential approval hierarchy
-- (Line Manager -> Department Head -> Finance/Budget Controller)
-- -----------------------------------------------------------------------------

CREATE TABLE approval_steps (
  id                 SERIAL PRIMARY KEY,
  budget_request_id  INTEGER NOT NULL REFERENCES budget_requests(id),
  step_order         INTEGER NOT NULL,           -- 1=Line Manager, 2=Dept Head, 3=Finance
  approver_role      user_role NOT NULL,
  approver_id        INTEGER REFERENCES users(id),
  status             approval_step_status NOT NULL DEFAULT 'PENDING',
  comments           TEXT,
  -- Digital signature = sha256(approverId + ISO timestamp + budgetRequestId
  -- + decision). Recomputable and cross-referenceable against audit_logs
  -- for CapEx audit trail purposes.
  digital_signature  VARCHAR(128),
  acted_at           TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_steps_request ON approval_steps(budget_request_id);
CREATE INDEX idx_approval_steps_approver ON approval_steps(approver_id);

-- -----------------------------------------------------------------------------
-- Clarification request/response thread
-- -----------------------------------------------------------------------------

CREATE TABLE clarifications (
  id                 SERIAL PRIMARY KEY,
  budget_request_id  INTEGER NOT NULL REFERENCES budget_requests(id),
  approval_step_id   INTEGER NOT NULL REFERENCES approval_steps(id),
  requested_by_id    INTEGER NOT NULL REFERENCES users(id),
  question           TEXT NOT NULL,
  response           TEXT,
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at       TIMESTAMPTZ
);

CREATE INDEX idx_clarifications_request ON clarifications(budget_request_id);

-- -----------------------------------------------------------------------------
-- Audit trail - append-only. One row per action / status change. Never
-- updated or deleted; this is the system of record for CapEx audit.
-- -----------------------------------------------------------------------------

CREATE TABLE audit_logs (
  id              SERIAL PRIMARY KEY,
  entity_type     VARCHAR(40) NOT NULL,
  entity_id       INTEGER NOT NULL,
  action          VARCHAR(60) NOT NULL,
  actor_id        INTEGER REFERENCES users(id),
  actor_role      user_role,
  from_status     budget_status,
  to_status       budget_status,
  comments        TEXT,
  digital_signature VARCHAR(128),
  metadata        JSONB,
  ip_address      VARCHAR(64),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- -----------------------------------------------------------------------------
-- SAP integration log - one row per RFC call attempt (incl. retries)
-- -----------------------------------------------------------------------------

CREATE TABLE sap_integration_logs (
  id                 SERIAL PRIMARY KEY,
  budget_request_id  INTEGER NOT NULL REFERENCES budget_requests(id),
  attempt_number     INTEGER NOT NULL DEFAULT 1,
  rfc_function_name  VARCHAR(60) NOT NULL,        -- e.g. ZBUDGET_CREATE_AUC_IO
  request_payload    JSONB,
  response_payload   JSONB,
  status             sap_log_status NOT NULL DEFAULT 'PENDING',
  error_message      TEXT,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  duration_ms        INTEGER
);

CREATE INDEX idx_sap_logs_request ON sap_integration_logs(budget_request_id);
CREATE INDEX idx_sap_logs_status ON sap_integration_logs(status);

COMMIT;
