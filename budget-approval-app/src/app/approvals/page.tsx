import { RequestsList } from "@/components/RequestsList";

export default function ApprovalQueuePage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Approval Queue</h1>
      <p className="mt-1 text-sm text-gray-600">Budget requests currently awaiting your decision.</p>
      <div className="mt-6">
        <RequestsList scope="pending-my-approval" emptyMessage="Nothing is waiting on your approval right now." />
      </div>
    </div>
  );
}
