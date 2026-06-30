import {
  pgTable,
  serial,
  text,
  varchar,
  numeric,
  timestamp,
  integer,
  jsonb,
  pgEnum,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", [
  "REQUESTOR",
  "LINE_MANAGER",
  "DEPARTMENT_HEAD",
  "FINANCE_CONTROLLER",
  "ADMIN",
]);

// Formal state machine states for a budget request.
export const budgetStatusEnum = pgEnum("budget_status", [
  "DRAFT",
  "PENDING_LINE_MANAGER",
  "PENDING_DEPARTMENT_HEAD",
  "PENDING_FINANCE",
  "CLARIFICATION_REQUESTED",
  "APPROVED",
  "REJECTED",
  "SAP_PROCESSING",
  "SAP_COMPLETED",
  "SAP_FAILED",
  "CANCELLED",
]);

export const approvalStepStatusEnum = pgEnum("approval_step_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CLARIFICATION_REQUESTED",
  "SKIPPED",
]);

export const sapLogStatusEnum = pgEnum("sap_log_status", [
  "PENDING",
  "SUCCESS",
  "FAILED",
  "TIMEOUT",
  "RETRYING",
]);

// ---------------------------------------------------------------------------
// Master / reference data
// ---------------------------------------------------------------------------

export const costCenters = pgTable("cost_centers", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  department: varchar("department", { length: 120 }).notNull(),
  plant: varchar("plant", { length: 60 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const glAccounts = pgTable("gl_accounts", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  // AUC = Asset Under Construction. CAPEX accounts must map to an SAP asset
  // class so the AUC settlement / capitalization run knows where to post.
  accountType: varchar("account_type", { length: 20 }).notNull(), // CAPEX | OPEX
  defaultAssetClass: varchar("default_asset_class", { length: 20 }), // e.g. "AUC-PLANT", "AUC-IT"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Pre-defined fiscal limits used for server-side validation at submission
// time, per cost center / GL account / fiscal year.
export const fiscalLimits = pgTable(
  "fiscal_limits",
  {
    id: serial("id").primaryKey(),
    costCenterId: integer("cost_center_id")
      .notNull()
      .references(() => costCenters.id),
    glAccountId: integer("gl_account_id")
      .notNull()
      .references(() => glAccounts.id),
    fiscalYear: integer("fiscal_year").notNull(),
    maxSingleRequestAmount: numeric("max_single_request_amount", { precision: 18, scale: 2 }).notNull(),
    maxAnnualAmount: numeric("max_annual_amount", { precision: 18, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("EGP"),
  },
  (t) => [uniqueIndex("fiscal_limits_unique").on(t.costCenterId, t.glAccountId, t.fiscalYear)],
);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  employeeId: varchar("employee_id", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 160 }).notNull().unique(),
  role: userRoleEnum("role").notNull(),
  department: varchar("department", { length: 120 }),
  costCenterId: integer("cost_center_id").references(() => costCenters.id),
  managerId: integer("manager_id"), // self-reference, FK added in migration
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Budget request (the staging record before SAP posting)
// ---------------------------------------------------------------------------

export const budgetRequests = pgTable("budget_requests", {
  id: serial("id").primaryKey(),
  requestNumber: varchar("request_number", { length: 30 }).notNull().unique(),

  projectName: varchar("project_name", { length: 200 }).notNull(),
  costCenterId: integer("cost_center_id")
    .notNull()
    .references(() => costCenters.id),
  glAccountId: integer("gl_account_id")
    .notNull()
    .references(() => glAccounts.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("EGP"),
  justification: text("justification").notNull(),

  // AUC classification, fixed at submission time but editable until approved.
  assetClass: varchar("asset_class", { length: 20 }).notNull(),

  requestorId: integer("requestor_id")
    .notNull()
    .references(() => users.id),
  lineManagerId: integer("line_manager_id").references(() => users.id),
  departmentHeadId: integer("department_head_id").references(() => users.id),
  financeControllerId: integer("finance_controller_id").references(() => users.id),

  status: budgetStatusEnum("status").notNull().default("DRAFT"),

  // SAP linkage, populated once the IO has been created.
  sapInternalOrderNumber: varchar("sap_internal_order_number", { length: 20 }),
  sapPostingStatus: sapLogStatusEnum("sap_posting_status"),
  sapPostedAt: timestamp("sap_posted_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per stage of the sequential approval hierarchy.
export const approvalSteps = pgTable("approval_steps", {
  id: serial("id").primaryKey(),
  budgetRequestId: integer("budget_request_id")
    .notNull()
    .references(() => budgetRequests.id),
  stepOrder: integer("step_order").notNull(), // 1=Line Manager, 2=Dept Head, 3=Finance
  approverRole: userRoleEnum("approver_role").notNull(),
  approverId: integer("approver_id").references(() => users.id),
  status: approvalStepStatusEnum("status").notNull().default("PENDING"),
  comments: text("comments"),
  // Digital signature = approver user id + ISO timestamp, hashed. Stored
  // alongside the plain fields so it can be independently recomputed and
  // cross-referenced against the audit log during an internal audit.
  digitalSignature: varchar("digital_signature", { length: 128 }),
  actedAt: timestamp("acted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Clarification request/response thread, linked to the approval step that
// raised the question.
export const clarifications = pgTable("clarifications", {
  id: serial("id").primaryKey(),
  budgetRequestId: integer("budget_request_id")
    .notNull()
    .references(() => budgetRequests.id),
  approvalStepId: integer("approval_step_id")
    .notNull()
    .references(() => approvalSteps.id),
  requestedById: integer("requested_by_id")
    .notNull()
    .references(() => users.id),
  question: text("question").notNull(),
  response: text("response"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Audit trail - append-only, one row per status change / action.
// ---------------------------------------------------------------------------

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  entityType: varchar("entity_type", { length: 40 }).notNull(), // "BUDGET_REQUEST"
  entityId: integer("entity_id").notNull(),
  action: varchar("action", { length: 60 }).notNull(), // SUBMITTED, APPROVED, REJECTED, ...
  actorId: integer("actor_id").references(() => users.id),
  actorRole: userRoleEnum("actor_role"),
  fromStatus: budgetStatusEnum("from_status"),
  toStatus: budgetStatusEnum("to_status"),
  comments: text("comments"),
  // Approver's digital signature: sha256(userId + actionTimestamp + entityId + toStatus).
  digitalSignature: varchar("digital_signature", { length: 128 }),
  metadata: jsonb("metadata"),
  ipAddress: varchar("ip_address", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// SAP integration log - one row per RFC call attempt.
// ---------------------------------------------------------------------------

export const sapIntegrationLogs = pgTable("sap_integration_logs", {
  id: serial("id").primaryKey(),
  budgetRequestId: integer("budget_request_id")
    .notNull()
    .references(() => budgetRequests.id),
  attemptNumber: integer("attempt_number").notNull().default(1),
  rfcFunctionName: varchar("rfc_function_name", { length: 60 }).notNull(),
  requestPayload: jsonb("request_payload"),
  responsePayload: jsonb("response_payload"),
  status: sapLogStatusEnum("status").notNull().default("PENDING"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
});

// ---------------------------------------------------------------------------
// Relations (for query convenience)
// ---------------------------------------------------------------------------

export const budgetRequestsRelations = relations(budgetRequests, ({ one, many }) => ({
  requestor: one(users, { fields: [budgetRequests.requestorId], references: [users.id] }),
  costCenter: one(costCenters, { fields: [budgetRequests.costCenterId], references: [costCenters.id] }),
  glAccount: one(glAccounts, { fields: [budgetRequests.glAccountId], references: [glAccounts.id] }),
  approvalSteps: many(approvalSteps),
  auditLogs: many(auditLogs),
  sapLogs: many(sapIntegrationLogs),
}));

export const approvalStepsRelations = relations(approvalSteps, ({ one }) => ({
  budgetRequest: one(budgetRequests, {
    fields: [approvalSteps.budgetRequestId],
    references: [budgetRequests.id],
  }),
  approver: one(users, { fields: [approvalSteps.approverId], references: [users.id] }),
}));

export const usersRelations = relations(users, ({ one }) => ({
  costCenter: one(costCenters, { fields: [users.costCenterId], references: [costCenters.id] }),
}));
