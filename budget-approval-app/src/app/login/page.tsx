"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS } from "@/lib/format";

type DemoUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  department: string | null;
};

export default function LoginPage() {
  const router = useRouter();
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((data) => setUsers(data.users))
      .finally(() => setLoading(false));
  }, []);

  async function login(userId: number) {
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "Login failed.");
      return;
    }
    router.push("/requests");
    router.refresh();
  }

  const grouped = users.reduce<Record<string, DemoUser[]>>((acc, u) => {
    (acc[u.role] ??= []).push(u);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold text-gray-900">Sign in</h1>
      <p className="mt-2 text-sm text-gray-600">
        Demo authentication: pick a user to sign in as. In production this screen is replaced by
        Azure AD / SSO single sign-on (see README for the migration plan) — every API route only
        depends on the resulting session, so swapping the identity provider doesn&apos;t touch
        workflow logic.
      </p>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Loading users…</p>
      ) : (
        <div className="mt-6 space-y-6">
          {Object.entries(grouped).map(([role, roleUsers]) => (
            <div key={role}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {ROLE_LABELS[role] ?? role}
              </h2>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {roleUsers.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => login(u.id)}
                    className="flex flex-col items-start rounded-lg border border-gray-200 bg-white px-4 py-3 text-left shadow-sm hover:border-indigo-400 hover:shadow"
                  >
                    <span className="font-medium text-gray-900">{u.name}</span>
                    <span className="text-xs text-gray-500">
                      {u.email} {u.department ? `· ${u.department}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
