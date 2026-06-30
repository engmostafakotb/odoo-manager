export function formatCurrency(amount: string | number, currency: string) {
  const value = typeof amount === "string" ? Number(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

export function formatDateTime(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_LINE_MANAGER: "Pending Line Manager",
  PENDING_DEPARTMENT_HEAD: "Pending Department Head",
  PENDING_FINANCE: "Pending Finance Controller",
  CLARIFICATION_REQUESTED: "Clarification Requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SAP_PROCESSING: "Posting to SAP…",
  SAP_COMPLETED: "Completed (SAP IO Created)",
  SAP_FAILED: "SAP Posting Failed",
  CANCELLED: "Cancelled",
};

export const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING_LINE_MANAGER: "bg-amber-100 text-amber-800",
  PENDING_DEPARTMENT_HEAD: "bg-amber-100 text-amber-800",
  PENDING_FINANCE: "bg-amber-100 text-amber-800",
  CLARIFICATION_REQUESTED: "bg-blue-100 text-blue-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-800",
  SAP_PROCESSING: "bg-indigo-100 text-indigo-800",
  SAP_COMPLETED: "bg-emerald-100 text-emerald-800",
  SAP_FAILED: "bg-red-100 text-red-800",
  CANCELLED: "bg-gray-100 text-gray-700",
};

export const ROLE_LABELS: Record<string, string> = {
  REQUESTOR: "Requestor",
  LINE_MANAGER: "Line Manager",
  DEPARTMENT_HEAD: "Department Head",
  FINANCE_CONTROLLER: "Finance Controller",
  ADMIN: "Admin",
};
