"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { StatusBadge } from "./StatusBadge";
import { formatCurrency, formatDateTime, ROLE_LABELS } from "@/lib/format";

type CurrentUser = { id: number; name: string; role: string };

type ApprovalStepRow = {
  id: number;
  stepOrder: number;
  approverRole: string;
  status: string;
  comments: string | null;
  digitalSignature: string | null;
  actedAt: string | null;
  approver: { id: number; name: string } | null;
};

type ClarificationRow = {
  id: number;
  question: string;
  response: string | null;
  requestedAt: string;
  respondedAt: string | null;
};

type SapLogRow = {
  id: number;
  attemptNumber: number;
  rfcFunctionName: string;
  status: string;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  responsePayload: unknown;
};

type AuditLogRow = {
  id: number;
  action: string;
  actorId: number | null;
  actorRole: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  comments: string | null;
  digitalSignature: string | null;
  createdAt: string;
};

type RequestDetailData = {
  request: {
    id: number;
    requestNumber: string;
    projectName: string;
    amount: string;
    currency: string;
    justification: string;
    assetClass: string;
    status: string;
    requestorId: number;
    lineManagerId: number | null;
    departmentHeadId: number | null;
    financeControllerId: number | null;
    sapInternalOrderNumber: string | null;
    sapPostingStatus: string | null;
    sapPostedAt: string | null;
    createdAt: string;
  };
  costCenter: { code: string; name: string } | null;
  glAccount: { code: string; name: string } | null;
  requestor: { id: number; name: string; email: string } | null;
  approvalSteps: ApprovalStepRow[];
  clarifications: ClarificationRow[];
  sapLogs: SapLogRow[];
};

const APPROVER_ID_FIELD: Record<string, "lineManagerId" | "departmentHeadId" | "financeControllerId"> = {
  PENDING_LINE_MANAGER: "lineManagerId",
  PENDING_DEPARTMENT_HEAD: "departmentHeadId",
  PENDING_FINANCE: "financeControllerId",
};

export function RequestDetail({ id }: { id: number }) {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [detail, setDetail] = useState<RequestDetailData | null>(null);
  const [auditTrail, setAuditTrail] = useState<AuditLogRow[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [rejectComment, setRejectComment] = useState("");
  const [clarifyComment, setClarifyComment] = useState("");
  const [clarifyResponse, setClarifyResponse] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showClarify, setShowClarify] = useState(false);

  const load = useCallback(async () => {
    const [detailRes, auditRes] = await Promise.all([
      fetch(`/api/budget-requests/${id}`),
      fetch(`/api/budget-requests/${id}/audit-trail`),
    ]);
    if (detailRes.status === 404) {
      setNotFound(true);
      return;
    }
    const detailData = await detailRes.json();
    setDetail(detailData);
    if (auditRes.ok) {
      const auditData = await auditRes.json();
      setAuditTrail(auditData.auditTrail ?? []);
    }
  }, [id]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setMe(d.user));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount, not a render-loop setState
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  async function act(path: string, body?: Record<string, unknown>) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/budget-requests/${id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Action failed.");
        return;
      }
      setShowReject(false);
      setShowClarify(false);
      setRejectComment("");
      setClarifyComment("");
      setClarifyResponse("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (notFound) return <p className="text-sm text-gray-500">Budget request not found.</p>;
  if (!detail || !me) return <p className="text-sm text-gray-500">Loading…</p>;

  const { request, costCenter, glAccount, requestor, approvalSteps, clarifications, sapLogs } = detail;

  const approverField = APPROVER_ID_FIELD[request.status];
  const isAssignedApprover = approverField != null && request[approverField] === me.id;
  const canActOnApproval = isAssignedApprover;
  const canRespondClarification = request.status === "CLARIFICATION_REQUESTED" && request.requestorId === me.id;
  const canRetrySap = request.status === "SAP_FAILED" && me.role === "ADMIN";
  const openClarification = clarifications.find((c) => !c.response);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/requests" className="text-sm text-indigo-600 hover:underline">
            ← Back to requests
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">{request.requestNumber}</h1>
          <p className="text-gray-600">{request.projectName}</p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:grid-cols-2">
        <Field label="Requestor" value={requestor ? `${requestor.name} (${requestor.email})` : "—"} />
        <Field label="Amount" value={formatCurrency(request.amount, request.currency)} />
        <Field label="Cost Center" value={costCenter ? `${costCenter.code} — ${costCenter.name}` : "—"} />
        <Field label="GL Account" value={glAccount ? `${glAccount.code} — ${glAccount.name}` : "—"} />
        <Field label="Asset Class (AUC)" value={request.assetClass} />
        <Field label="Submitted" value={formatDateTime(request.createdAt)} />
        <Field label="SAP Internal Order" value={request.sapInternalOrderNumber ?? "—"} />
        <Field label="SAP Posted At" value={request.sapPostedAt ? formatDateTime(request.sapPostedAt) : "—"} />
        <div className="sm:col-span-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Justification</div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">{request.justification}</p>
        </div>
      </div>

      {(canActOnApproval || canRespondClarification || canRetrySap) && (
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Actions</h2>

          {canActOnApproval && !showReject && !showClarify && (
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                disabled={busy}
                onClick={() => act("approve")}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                disabled={busy}
                onClick={() => setShowReject(true)}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Reject with Comments
              </button>
              <button
                disabled={busy}
                onClick={() => setShowClarify(true)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Request Clarification
              </button>
            </div>
          )}

          {showReject && (
            <div className="mt-3 space-y-2">
              <textarea
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
                rows={3}
                placeholder="Reason for rejection (required)"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
              />
              <div className="flex gap-3">
                <button
                  disabled={busy || !rejectComment.trim()}
                  onClick={() => act("reject", { comments: rejectComment })}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Confirm Reject
                </button>
                <button onClick={() => setShowReject(false)} className="text-sm text-gray-600 hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {showClarify && (
            <div className="mt-3 space-y-2">
              <textarea
                value={clarifyComment}
                onChange={(e) => setClarifyComment(e.target.value)}
                rows={3}
                placeholder="What needs clarifying? (required)"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
              />
              <div className="flex gap-3">
                <button
                  disabled={busy || !clarifyComment.trim()}
                  onClick={() => act("request-clarification", { comments: clarifyComment })}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Send
                </button>
                <button onClick={() => setShowClarify(false)} className="text-sm text-gray-600 hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {canRespondClarification && openClarification && (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-gray-700">
                <span className="font-medium">Question:</span> {openClarification.question}
              </p>
              <textarea
                value={clarifyResponse}
                onChange={(e) => setClarifyResponse(e.target.value)}
                rows={3}
                placeholder="Your response (required)"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
              />
              <button
                disabled={busy || !clarifyResponse.trim()}
                onClick={() => act("respond-clarification", { response: clarifyResponse })}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Submit Response
              </button>
            </div>
          )}

          {canRetrySap && (
            <div className="mt-3">
              <button
                disabled={busy}
                onClick={() => act("retry-sap")}
                className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                Retry SAP Posting
              </button>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Approval Timeline</h2>
        <ol className="mt-3 space-y-3">
          {approvalSteps.map((step) => (
            <li key={step.id} className="rounded-md border border-gray-100 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">
                  {ROLE_LABELS[step.approverRole] ?? step.approverRole}
                  {step.approver ? ` — ${step.approver.name}` : ""}
                </span>
                <StatusBadge status={step.status} />
              </div>
              {step.comments && <p className="mt-1 text-sm text-gray-600">{step.comments}</p>}
              {step.actedAt && (
                <p className="mt-1 text-xs text-gray-400">
                  {formatDateTime(step.actedAt)} · signature: <code>{step.digitalSignature}</code>
                </p>
              )}
            </li>
          ))}
        </ol>
      </div>

      {clarifications.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Clarification Thread</h2>
          <div className="mt-3 space-y-3">
            {clarifications.map((c) => (
              <div key={c.id} className="rounded-md border border-gray-100 px-3 py-2">
                <p className="text-sm text-gray-900">
                  <span className="font-medium">Q:</span> {c.question}
                </p>
                <p className="text-xs text-gray-400">{formatDateTime(c.requestedAt)}</p>
                {c.response ? (
                  <>
                    <p className="mt-2 text-sm text-gray-900">
                      <span className="font-medium">A:</span> {c.response}
                    </p>
                    <p className="text-xs text-gray-400">{c.respondedAt ? formatDateTime(c.respondedAt) : ""}</p>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-amber-600">Awaiting response from requestor.</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {sapLogs.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">SAP Integration Log</h2>
          <div className="mt-3 space-y-3">
            {sapLogs.map((log) => (
              <div key={log.id} className="rounded-md border border-gray-100 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">
                    Attempt {log.attemptNumber} · {log.rfcFunctionName}
                  </span>
                  <StatusBadge status={log.status} />
                </div>
                {log.errorMessage && <p className="mt-1 text-sm text-red-600">{log.errorMessage}</p>}
                <p className="mt-1 text-xs text-gray-400">
                  Started {formatDateTime(log.startedAt)}
                  {log.completedAt ? ` · completed ${formatDateTime(log.completedAt)}` : ""}
                  {log.durationMs != null ? ` · ${log.durationMs}ms` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Audit Trail</h2>
        <div className="mt-3 overflow-hidden rounded-md border border-gray-100">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">From → To</th>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Signature</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {auditTrail.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2 text-gray-900">{a.action}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {a.actorId ?? "system"} {a.actorRole ? `(${ROLE_LABELS[a.actorRole] ?? a.actorRole})` : ""}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {a.fromStatus ?? "—"} → {a.toStatus ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-400">{formatDateTime(a.createdAt)}</td>
                  <td className="px-3 py-2 text-gray-400">
                    {a.digitalSignature ? <code className="text-xs">{a.digitalSignature.slice(0, 16)}…</code> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-sm text-gray-900">{value}</div>
    </div>
  );
}
