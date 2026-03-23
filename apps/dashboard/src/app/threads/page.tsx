"use client";
import { useState } from "react";
import { useThreads } from "@/hooks/use-control-plane";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/utils";

function extractTitle(goal: string): string {
  if (!goal) return "—";
  const firstLine = goal.split("\n").find((line) => line.trim()) || goal;
  const clean = firstLine.replace(/^#+\s*/, "").trim();
  return clean.length > 100 ? clean.slice(0, 97) + "..." : clean;
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "RUNNING", label: "Running" },
  { key: "COMPLETED", label: "Completed" },
  { key: "FAILED", label: "Failed" },
  { key: "CREATED", label: "Created" },
];

export default function ThreadsPage() {
  const { threads, loading } = useThreads();
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = filter === "all" ? threads : threads.filter((t) => t.status === filter);

  const counts: Record<string, number> = { all: threads.length };
  for (const t of threads) counts[t.status] = (counts[t.status] || 0) + 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Threads & Runs</h1>
        <p className="mt-1 text-sm text-neutral-500">
          All mission threads. Each thread represents one agent goal.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : threads.length === 0 ? (
        <EmptyState
          title="No threads"
          description="Threads are created when agents execute missions."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-lg px-3 py-1.5 text-sm transition-all ${
                  filter === f.key
                    ? "bg-white/[0.1] text-white"
                    : "text-neutral-500 hover:bg-white/[0.04] hover:text-neutral-300"
                }`}
              >
                {f.label}
                <span className="ml-1.5 text-xs text-neutral-600">{counts[f.key] || 0}</span>
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {filtered.map((t) => (
              <div
                key={t.id}
                className="rounded-xl border border-white/[0.06] bg-neutral-950 p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-neutral-500">{t.id.slice(0, 8)}</span>
                    <StatusBadge status={t.status} />
                    <span className="text-xs text-neutral-600">{formatDate(t.created_at)}</span>
                  </div>
                  <span className="text-xs text-neutral-600">worker: {t.worker_id || "—"}</span>
                </div>

                <h3 className="mt-2 text-sm font-medium text-white">{extractTitle(t.goal)}</h3>
                <p className="mt-1 font-mono text-xs text-neutral-600">{t.workdir}</p>

                {t.goal && t.goal.length > 100 && (
                  <button
                    onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                    className="mt-2 text-xs text-neutral-500 transition-colors hover:text-neutral-300"
                  >
                    {expandedId === t.id ? "Hide details ▲" : "Show details ▼"}
                  </button>
                )}

                {expandedId === t.id && (
                  <div className="mt-3 rounded-lg border border-white/[0.04] bg-black/50 p-3">
                    <pre className="max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-neutral-400 scrollbar-thin">
                      {t.goal}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
