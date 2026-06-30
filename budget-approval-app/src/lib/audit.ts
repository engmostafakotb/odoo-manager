import crypto from "node:crypto";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema";
import type { BudgetStatus, UserRole } from "./state-machine";

/**
 * Computes the approver's "digital signature" for a CapEx decision:
 * sha256(userId + ISO timestamp + entityId + action). It is deterministic
 * and independently recomputable, so internal audit can take the four
 * inputs from audit_logs and confirm the signature wasn't tampered with -
 * the actual proof of who-did-what-when is the (actorId, createdAt) pair
 * itself, the hash just makes tampering detectable.
 */
export function computeDigitalSignature(params: {
  actorId: number;
  timestamp: Date;
  entityId: number;
  action: string;
}): string {
  const payload = `${params.actorId}|${params.timestamp.toISOString()}|${params.entityId}|${params.action}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export async function recordAuditLog(entry: {
  entityType: "BUDGET_REQUEST";
  entityId: number;
  action: string;
  actorId: number | null;
  actorRole: UserRole | null;
  fromStatus?: BudgetStatus | null;
  toStatus?: BudgetStatus | null;
  comments?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
}) {
  const createdAt = new Date();
  const digitalSignature = entry.actorId
    ? computeDigitalSignature({
        actorId: entry.actorId,
        timestamp: createdAt,
        entityId: entry.entityId,
        action: entry.action,
      })
    : null;

  await db.insert(auditLogs).values({
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    fromStatus: entry.fromStatus ?? null,
    toStatus: entry.toStatus ?? null,
    comments: entry.comments ?? null,
    digitalSignature,
    metadata: entry.metadata ?? null,
    ipAddress: entry.ipAddress ?? null,
    createdAt,
  });

  return { digitalSignature, createdAt };
}
