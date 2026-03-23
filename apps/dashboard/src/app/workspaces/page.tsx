"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspaces } from "@/hooks/use-workspaces";

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function WorkspacesPage() {
  const [workerFilter, setWorkerFilter] = useState("");
  const { workspaces, loading } = useWorkspaces(workerFilter || undefined);

  const workerOptions = useMemo(() => {
    return Array.from(new Set(workspaces.map((workspace) => workspace.worker_id))).sort();
  }, [workspaces]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Workspaces</h1>
          <p className="mt-1 text-sm text-neutral-500">Browse daemon-reported cmux workspaces and the surfaces running inside them.</p>
          <p className="text-sm text-neutral-400">{workspaces.length} workspaces reported</p>
        </div>
        <label className="flex items-center gap-3 text-sm text-neutral-400">
          <span>Worker</span>
          <select
            value={workerFilter}
            onChange={(event) => setWorkerFilter(event.target.value)}
            className="rounded-lg border border-white/[0.06] bg-neutral-950 px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none"
          >
            <option value="">All workers</option>
            {workerOptions.map((workerId) => (
              <option key={workerId} value={workerId}>
                {workerId}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-44 animate-pulse rounded-lg bg-neutral-950" />
          ))}
        </div>
      ) : workspaces.length === 0 ? (
        <EmptyState
          title="No workspaces reported yet"
          description="No workspaces reported yet. Start a local agent in daemon mode to see cmux workspaces and surfaces here in real time."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <p className="text-sm text-neutral-500 md:col-span-2 lg:col-span-3">
            Each workspace shows the linked worker, active thread/run context, and current surface count.
          </p>
          {workspaces.map((workspace) => (
            <div key={workspace.id} className="rounded-lg border border-white/[0.06] bg-neutral-950 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-white">{workspace.name}</h2>
                  <p className="mt-1 text-xs text-neutral-500">{workspace.id}</p>
                </div>
                <StatusBadge status={workspace.status} />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-neutral-300">{workspace.role}</span>
                <span className="rounded-full bg-black px-2 py-0.5 text-xs text-neutral-400">
                  worker {workspace.worker_id}
                </span>
                <span className="rounded-full bg-black px-2 py-0.5 text-xs text-neutral-400">
                  {(workspace.surfaces || []).length} surfaces
                </span>
              </div>
              <div className="mt-4 space-y-1 text-sm text-neutral-400">
                <p>thread: {workspace.current_thread_id || "—"}</p>
                <p>run: {workspace.current_run_id || "—"}</p>
                <p>last sync: {formatDate(workspace.last_sync_at)}</p>
              </div>
              <div className="mt-5 flex justify-end">
                <Link
                  href={`/workspaces/${workspace.id}`}
                  className="rounded-lg border border-white/[0.1] px-3 py-2 text-sm font-medium text-neutral-200 transition-colors hover:border-white/[0.1] hover:bg-white/[0.06]"
                >
                  View
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
