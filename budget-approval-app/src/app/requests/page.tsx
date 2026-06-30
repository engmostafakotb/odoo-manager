import { RequestsList } from "@/components/RequestsList";

export default function MyRequestsPage() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">My Requests</h1>
      </div>
      <p className="mt-1 text-sm text-gray-600">Budget requests you have submitted.</p>
      <div className="mt-6">
        <RequestsList scope="mine" emptyMessage="You haven't submitted any budget requests yet." />
      </div>
    </div>
  );
}
