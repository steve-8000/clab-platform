type StatusConfig = {
  dot: string;
  text: string;
  bg: string;
};

const statusConfig: Record<string, StatusConfig> = {
  CREATED: { dot: "bg-neutral-500", text: "text-neutral-300", bg: "bg-white/[0.05]" },
  RUNNING: { dot: "bg-sky-400", text: "text-sky-300", bg: "bg-sky-500/10" },
  PAUSED: { dot: "bg-amber-400", text: "text-amber-300", bg: "bg-amber-500/10" },
  COMPLETED: { dot: "bg-emerald-400", text: "text-emerald-300", bg: "bg-emerald-500/10" },
  FAILED: { dot: "bg-red-400", text: "text-red-300", bg: "bg-red-500/10" },
  CANCELED: { dot: "bg-neutral-600", text: "text-neutral-400", bg: "bg-white/[0.04]" },
  pending: { dot: "bg-amber-400", text: "text-amber-300", bg: "bg-amber-500/10" },
  resolved: { dot: "bg-emerald-400", text: "text-emerald-300", bg: "bg-emerald-500/10" },
  IDLE: { dot: "bg-neutral-500", text: "text-neutral-300", bg: "bg-white/[0.05]" },
  BOUND: { dot: "bg-indigo-400", text: "text-indigo-300", bg: "bg-indigo-500/10" },
  STALE: { dot: "bg-orange-400", text: "text-orange-300", bg: "bg-orange-500/10" },
  LOST: { dot: "bg-red-400", text: "text-red-300", bg: "bg-red-500/10" },
  CLOSED: { dot: "bg-neutral-600", text: "text-neutral-400", bg: "bg-white/[0.04]" },
  ACTIVE: { dot: "bg-emerald-400", text: "text-emerald-300", bg: "bg-emerald-500/10" },
  online: { dot: "bg-emerald-400", text: "text-emerald-300", bg: "bg-emerald-500/10" },
  offline: { dot: "bg-neutral-500", text: "text-neutral-300", bg: "bg-white/[0.05]" },
  degraded: { dot: "bg-red-400", text: "text-red-300", bg: "bg-red-500/10" },
  idle: { dot: "bg-neutral-500", text: "text-neutral-300", bg: "bg-white/[0.05]" },
  busy: { dot: "bg-amber-400", text: "text-amber-300", bg: "bg-amber-500/10" },
  running: { dot: "bg-sky-400", text: "text-sky-300", bg: "bg-sky-500/10" },
  reviewing: { dot: "bg-cyan-400", text: "text-cyan-300", bg: "bg-cyan-500/10" },
  fixing: { dot: "bg-orange-400", text: "text-orange-300", bg: "bg-orange-500/10" },
  waiting_input: { dot: "bg-fuchsia-400", text: "text-fuchsia-300", bg: "bg-fuchsia-500/10" },
  error: { dot: "bg-red-400", text: "text-red-300", bg: "bg-red-500/10" },
  queued: { dot: "bg-neutral-500", text: "text-neutral-300", bg: "bg-white/[0.05]" },
  sent: { dot: "bg-sky-400", text: "text-sky-300", bg: "bg-sky-500/10" },
  acked: { dot: "bg-indigo-400", text: "text-indigo-300", bg: "bg-indigo-500/10" },
  completed: { dot: "bg-emerald-400", text: "text-emerald-300", bg: "bg-emerald-500/10" },
  failed: { dot: "bg-red-400", text: "text-red-300", bg: "bg-red-500/10" },
  cancelled: { dot: "bg-neutral-600", text: "text-neutral-400", bg: "bg-white/[0.04]" },
};

const fallbackConfig: StatusConfig = {
  dot: "bg-neutral-500",
  text: "text-neutral-300",
  bg: "bg-white/[0.05]",
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? fallbackConfig;

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border border-white/[0.06] px-2.5 py-1 text-xs font-medium ${config.bg} ${config.text}`}
    >
      <span className={`h-2 w-2 rounded-full ${config.dot}`} />
      <span>{status}</span>
    </span>
  );
}
