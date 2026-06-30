import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { ROLE_LABELS } from "@/lib/format";
import { LogoutButton } from "./LogoutButton";

export async function NavBar() {
  const user = await getCurrentUser();

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-semibold text-gray-900">
          City Cement <span className="text-indigo-600">Budget Approval</span>
        </Link>
        {user && (
          <nav className="flex items-center gap-6">
            <Link href="/requests" className="text-sm text-gray-600 hover:text-gray-900">
              My Requests
            </Link>
            <Link href="/approvals" className="text-sm text-gray-600 hover:text-gray-900">
              Approval Queue
            </Link>
            <Link href="/requests/new" className="text-sm text-gray-600 hover:text-gray-900">
              New Request
            </Link>
            <div className="flex items-center gap-3 border-l border-gray-200 pl-6">
              <div className="text-right">
                <div className="text-sm font-medium text-gray-900">{user.name}</div>
                <div className="text-xs text-gray-500">{ROLE_LABELS[user.role] ?? user.role}</div>
              </div>
              <LogoutButton />
            </div>
          </nav>
        )}
      </div>
    </header>
  );
}
