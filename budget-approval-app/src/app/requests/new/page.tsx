"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type CostCenter = { id: number; code: string; name: string; department: string };
type GlAccount = { id: number; code: string; name: string; accountType: string; defaultAssetClass: string | null };
type FiscalLimit = {
  costCenterId: number;
  glAccountId: number;
  fiscalYear: number;
  maxSingleRequestAmount: string;
  maxAnnualAmount: string;
  currency: string;
};

const ASSET_CLASSES = [
  { value: "AUC-PLANT", label: "AUC - Plant & Machinery" },
  { value: "AUC-IT", label: "AUC - IT Equipment" },
  { value: "AUC-BUILD", label: "AUC - Buildings & Civil Works" },
  { value: "AUC-VEHICLE", label: "AUC - Vehicles & Mobile Equipment" },
];

export default function NewRequestPage() {
  const router = useRouter();
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [glAccounts, setGlAccounts] = useState<GlAccount[]>([]);
  const [fiscalLimits, setFiscalLimits] = useState<FiscalLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projectName, setProjectName] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [glAccountId, setGlAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("EGP");
  const [justification, setJustification] = useState("");
  const [assetClass, setAssetClass] = useState(ASSET_CLASSES[0].value);

  useEffect(() => {
    fetch("/api/reference-data")
      .then((r) => r.json())
      .then((data) => {
        setCostCenters(data.costCenters ?? []);
        setGlAccounts(data.glAccounts ?? []);
        setFiscalLimits(data.fiscalLimits ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  function onGlAccountChange(nextId: string) {
    setGlAccountId(nextId);
    const account = glAccounts.find((g) => g.id === Number(nextId));
    if (account?.defaultAssetClass) setAssetClass(account.defaultAssetClass);
  }

  const applicableLimit = fiscalLimits.find(
    (l) => l.costCenterId === Number(costCenterId) && l.glAccountId === Number(glAccountId),
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/budget-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName,
          costCenterId: Number(costCenterId),
          glAccountId: Number(glAccountId),
          amount: Number(amount),
          currency,
          justification,
          assetClass,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to submit request.");
        return;
      }
      router.push(`/requests/${data.budgetRequest.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold text-gray-900">New Budget Request</h1>
      <p className="mt-1 text-sm text-gray-600">
        Submit a CapEx budget request. On final approval this creates an Asset Under Construction (AUC)
        Internal Order in SAP S/4HANA automatically.
      </p>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <form onSubmit={onSubmit} className="mt-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700">Project Name</label>
          <input
            required
            minLength={3}
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
            placeholder="e.g. Kiln Line 2 Conveyor Upgrade"
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Cost Center</label>
            <select
              required
              value={costCenterId}
              onChange={(e) => setCostCenterId(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Select…</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">GL Account</label>
            <select
              required
              value={glAccountId}
              onChange={(e) => onGlAccountChange(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Select…</option>
              {glAccounts.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code} — {g.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Amount</label>
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
            />
            {applicableLimit && (
              <p className="mt-1 text-xs text-gray-500">
                Limit: {applicableLimit.maxSingleRequestAmount} {applicableLimit.currency} per request, up to{" "}
                {applicableLimit.maxAnnualAmount} {applicableLimit.currency} / FY{applicableLimit.fiscalYear}.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="EGP">EGP</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">SAP Asset Class (AUC)</label>
          <select
            required
            value={assetClass}
            onChange={(e) => setAssetClass(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
          >
            {ASSET_CLASSES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Determines the SAP asset class used when the Internal Order is created as Asset Under
            Construction. This must be correct now — it drives capitalization to the right Fixed Asset
            during settlement and cannot be safely changed after SAP posting.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Justification</label>
          <textarea
            required
            minLength={20}
            rows={4}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
            placeholder="Business case, expected ROI, urgency, etc. (min. 20 characters)"
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit Request"}
          </button>
        </div>
      </form>
    </div>
  );
}
