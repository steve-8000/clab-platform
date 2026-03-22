const COLORS: Record<string, string> = {
  // Run/Thread status
  CREATED: "bg-gray-700 text-gray-300",
  RUNNING: "bg-blue-900 text-blue-300",
  PAUSED: "bg-yellow-900 text-yellow-300",
  COMPLETED: "bg-green-900 text-green-300",
  FAILED: "bg-red-900 text-red-300",
  CANCELED: "bg-gray-700 text-gray-400",
  // Interrupt
  pending: "bg-amber-900 text-amber-300",
  resolved: "bg-green-900 text-green-300",
  // Session
  IDLE: "bg-gray-700 text-gray-300",
  BOUND: "bg-indigo-900 text-indigo-300",
  STALE: "bg-orange-900 text-orange-300",
  LOST: "bg-red-900 text-red-300",
  CLOSED: "bg-gray-800 text-gray-500",
  // cmux surface
  ACTIVE: "bg-green-900 text-green-300",
};

export function StatusBadge({ status }: { status: string }) {
  const color = COLORS[status] || "bg-gray-700 text-gray-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {status}
    </span>
  );
}
