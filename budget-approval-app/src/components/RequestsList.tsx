"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "./StatusBadge";
import { formatCurrency, formatDateTime } from "@/lib/format";

type BudgetRequestRow = {
  id: number;
  requestNumber: string;
  projectName: string;
  amount: string;
  currency: string;
  status: string;
  createdAt: string;
  sapInternalOrderNumber: string | null;
};

export function RequestsList({ scope, emptyMessage }: { scope: "mine" | "pending-my-approval" | "all"; emptyMessage: string }) {
  const [rows, setRows] = useState<BudgetRequestRow[] | null>(null);

  async function load() {
    const res = await fetch(`/api/budget-requests?scope=${scope}`);
    const data = await res.json();
    setRows(data.budgetRequests ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount, not a render-loop setState
    load();
    const interval = setInterval(load, 5000); // light polling so SAP_PROCESSING resolves live
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  if (rows === null) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3">Request #</th>
            <th className="px-4 py-3">Project</th>
            <th className="px-4 py-3">Amount</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">SAP IO</th>
            <th className="px-4 py-3">Submitted</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <Link href={`/requests/${r.id}`} className="font-medium text-indigo-600 hover:underline">
                  {r.requestNumber}
                </Link>
              </td>
              <td className="px-4 py-3 text-gray-900">{r.projectName}</td>
              <td className="px-4 py-3 text-gray-900">{formatCurrency(r.amount, r.currency)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-4 py-3 text-gray-500">{r.sapInternalOrderNumber ?? "—"}</td>
              <td className="px-4 py-3 text-gray-500">{formatDateTime(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
