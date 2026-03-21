const STATUS_STYLES: Record<string, string> = {
  // Mission statuses
  DRAFT: "bg-gray-700/50 text-gray-300 border-gray-600",
  PLANNED: "bg-blue-900/50 text-blue-300 border-blue-700",
  RUNNING: "bg-green-900/50 text-green-300 border-green-700",
  ACTIVE: "bg-green-900/50 text-green-300 border-green-700",
  COMPLETED: "bg-emerald-900/50 text-emerald-300 border-emerald-700",
  SUCCEEDED: "bg-emerald-900/50 text-emerald-300 border-emerald-700",
  FAILED: "bg-red-900/50 text-red-300 border-red-700",
  CANCELLED: "bg-gray-700/50 text-gray-400 border-gray-600",
  ABORTED: "bg-gray-700/50 text-gray-400 border-gray-600",
  REVIEW: "bg-orange-900/50 text-orange-300 border-orange-700",
  PENDING_REVIEW: "bg-orange-900/50 text-orange-300 border-orange-700",
  // Task statuses
  PENDING: "bg-blue-900/50 text-blue-300 border-blue-700",
  QUEUED: "bg-blue-900/50 text-blue-300 border-blue-700",
  BLOCKED: "bg-yellow-900/50 text-yellow-300 border-yellow-700",
  // Session states
  IDLE: "bg-gray-700/50 text-gray-300 border-gray-600",
  STALE: "bg-yellow-900/50 text-yellow-300 border-yellow-700",
  CLOSED: "bg-gray-700/50 text-gray-500 border-gray-600",
  // Priority
  LOW: "bg-gray-700/50 text-gray-300 border-gray-600",
  MEDIUM: "bg-blue-900/50 text-blue-300 border-blue-700",
  HIGH: "bg-orange-900/50 text-orange-300 border-orange-700",
  CRITICAL: "bg-red-900/50 text-red-300 border-red-700",
};

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
  className?: string;
}

export function StatusBadge({ status, size = "sm", className = "" }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] || "bg-gray-700/50 text-gray-300 border-gray-600";
  const sizeClass = size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";

  return (
    <span className={`inline-flex items-center rounded-md border font-mono font-medium ${style} ${sizeClass} ${className}`}>
      {status}
    </span>
  );
}
