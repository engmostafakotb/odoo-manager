import type { UserRole } from "./state-machine";

export type Permission =
  | "budget:create"
  | "budget:view:own"
  | "budget:view:all"
  | "budget:approve"
  | "budget:reject"
  | "budget:request-clarification"
  | "budget:respond-clarification"
  | "budget:cancel"
  | "audit:view"
  | "admin:manage-users";

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  REQUESTOR: ["budget:create", "budget:view:own", "budget:respond-clarification"],
  LINE_MANAGER: [
    "budget:create",
    "budget:view:own",
    "budget:approve",
    "budget:reject",
    "budget:request-clarification",
    "budget:respond-clarification",
  ],
  DEPARTMENT_HEAD: [
    "budget:create",
    "budget:view:own",
    "budget:view:all",
    "budget:approve",
    "budget:reject",
    "budget:request-clarification",
    "budget:respond-clarification",
  ],
  FINANCE_CONTROLLER: [
    "budget:view:all",
    "budget:approve",
    "budget:reject",
    "budget:request-clarification",
    "audit:view",
  ],
  ADMIN: [
    "budget:create",
    "budget:view:own",
    "budget:view:all",
    "budget:approve",
    "budget:reject",
    "budget:request-clarification",
    "budget:respond-clarification",
    "budget:cancel",
    "audit:view",
    "admin:manage-users",
  ],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
  }
}

export function requirePermission(role: UserRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new ForbiddenError(`Role ${role} lacks permission ${permission}.`);
  }
}
