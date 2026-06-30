import { STATUS_COLORS, STATUS_LABELS } from "@/lib/format";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
        STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700"
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
