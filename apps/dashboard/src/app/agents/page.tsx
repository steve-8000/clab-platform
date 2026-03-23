"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { cp } from "@/lib/api";
import type { SurfaceRuntime, WorkerRuntime, WorkspaceRuntime } from "@/types";

const REFRESH_INTERVAL_MS = 3000;
const HIGHLIGHT_DURATION_MS = 1400;

const STATUS_DOT: Record<string, string> = {
  online: "bg-emerald-400",
  idle: "bg-emerald-400",
  running: "bg-amber-300",
  busy: "bg-amber-300",
  reviewing: "bg-sky-300",
  fixing: "bg-orange-300",
  waiting_input: "bg-violet-300",
  degraded: "bg-yellow-300",
  error: "bg-rose-400",
  offline: "bg-neutral-600",
};

const ROLE_TONE: Record<string, string> = {
  reviewer: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  planner: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  worker: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  browser: "border-violet-500/30 bg-violet-500/10 text-violet-200",
  shell: "border-neutral-500/30 bg-neutral-500/10 text-neutral-200",
};

const ENGINE_ICON: Record<string, string> = {
  codex: ">",
  claude: "O",
  browser: "@",
  shell: "$",
};

function timeAgo(value?: string | Date): string {
  if (!value) return "—";
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "—";

  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 5000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function workspaceLabel(workspace: WorkspaceRuntime): string {
  const workspaceId = workspace.workspace_id || workspace.id || "";
  return workspace.name || `Workspace ${workspaceId.slice(0, 8)}`;
}

function serializeWorker(worker: WorkerRuntime): string {
  return JSON.stringify([
    worker.status,
    worker.last_heartbeat,
    worker.connected_at,
    worker.workdir,
    worker.capabilities,
  ]);
}

function serializeWorkspace(workspace: WorkspaceRuntime): string {
  return JSON.stringify([
    workspace.status,
    workspace.last_sync_at,
    workspace.current_run_id,
    workspace.current_thread_id,
    workspace.surfaces?.length ?? 0,
  ]);
}

function serializeSurface(surface: SurfaceRuntime): string {
  return JSON.stringify([
    surface.status,
    surface.last_activity_at,
    surface.last_output_excerpt,
    surface.engine,
    surface.role,
  ]);
}

function LoadingShell() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/[0.1] bg-neutral-950 p-6">
        <div className="h-7 w-56 animate-pulse rounded bg-white/10" />
        <div className="mt-3 h-4 w-80 animate-pulse rounded bg-white/5" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="h-14 animate-pulse rounded-xl border border-white/[0.1] bg-neutral-950" />
        ))}
      </div>
      <div className="rounded-xl border border-white/[0.1] bg-neutral-950 p-4">
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-9 w-32 animate-pulse rounded-lg bg-white/[0.06]" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="h-80 animate-pulse rounded-xl border border-white/[0.1] bg-neutral-950" />
        ))}
      </div>
    </div>
  );
}

function WorkerCard({
  worker,
  changed,
  workspaceCount,
  surfaceCount,
}: {
  worker: WorkerRuntime;
  changed: boolean;
  workspaceCount: number;
  surfaceCount: number;
}) {
  const dotClass = STATUS_DOT[worker.status] || STATUS_DOT.offline;

  return (
    <div
      className={[
        "flex flex-col gap-3 rounded-xl border bg-neutral-950 px-4 py-3 transition-all lg:flex-row lg:items-center lg:justify-between",
        changed ? "animate-pulse border-amber-300/50" : "border-white/[0.1]",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
        <span className="font-semibold text-white">{worker.hostname || worker.worker_id}</span>
        <div className="flex flex-wrap gap-1">
          {worker.capabilities.length > 0 ? (
            worker.capabilities.map((capability) => (
              <span key={capability} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-neutral-400">
                {capability}
              </span>
            ))
          ) : (
            <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-neutral-500">no caps</span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-500">
        <span>heartbeat {timeAgo(worker.last_heartbeat)}</span>
        <span>{workspaceCount} workspace{workspaceCount === 1 ? "" : "s"}</span>
        <span>{surfaceCount} surface{surfaceCount === 1 ? "" : "s"}</span>
        <span>{[worker.platform, worker.version].filter(Boolean).join(" / ") || "—"}</span>
      </div>
    </div>
  );
}

function PromptInput({ surfaceId, workerId }: { surfaceId: string; workerId: string }) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!value.trim() || sending) return;

    setSending(true);
    try {
      await cp.dispatchPrompt({ worker_id: workerId, surface_id: surfaceId, prompt: value.trim() });
      setValue("");
    } catch {
      // Keep the draft intact if dispatch fails.
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") send();
        }}
        placeholder="Send a message to this surface..."
        className="flex-1 rounded-lg border border-white/[0.1] bg-black px-3 py-1.5 text-sm text-white placeholder-neutral-600 focus:border-white/[0.2] focus:outline-none"
        disabled={sending}
      />
      <button
        onClick={send}
        disabled={sending || !value.trim()}
        className="rounded-lg bg-white/[0.08] px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:bg-white/[0.14] disabled:opacity-40"
      >
        {sending ? "..." : "Send"}
      </button>
    </div>
  );
}

function SurfaceCard({
  surface,
  changed,
  workerId,
}: {
  surface: SurfaceRuntime;
  changed: boolean;
  workerId: string;
}) {
  const excerpt = surface.last_output_excerpt || "";
  const dotClass = STATUS_DOT[surface.status] || STATUS_DOT.offline;
  const roleTone = ROLE_TONE[surface.role] || ROLE_TONE.shell;

  return (
    <div
      className={[
        "overflow-hidden rounded-xl border border-white/[0.1] transition-all",
        changed ? "animate-pulse border-amber-300/50" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-neutral-950 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-xs text-neutral-500">{ENGINE_ICON[surface.engine] || "?"}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${roleTone}`}>{surface.role}</span>
          <span className="truncate text-[11px] text-neutral-500">{surface.engine}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${dotClass}`} />
          <span className="text-[11px] text-neutral-500">{surface.status}</span>
        </div>
      </div>

      <div className="bg-[#0d0d0d] p-3">
        <pre className="min-h-[300px] max-h-[600px] overflow-y-auto whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-neutral-200 scrollbar-thin">
          {excerpt || "waiting for output..."}
        </pre>
      </div>

      <div className="border-t border-white/[0.08] bg-neutral-950 px-3 py-2">
        <div className="mb-2 flex items-center justify-between text-[11px] text-neutral-500">
          <span className="truncate">{surface.name || surface.surface_id}</span>
          <span className="shrink-0">{timeAgo(surface.last_activity_at)}</span>
        </div>
        <PromptInput surfaceId={surface.surface_id} workerId={workerId} />
      </div>
    </div>
  );
}

function WorkspaceTabs({
  workspaces,
  selectedWsIndex,
  setSelectedWsIndex,
  changedWorkspaceIds,
}: {
  workspaces: WorkspaceRuntime[];
  selectedWsIndex: number;
  setSelectedWsIndex: (index: number) => void;
  changedWorkspaceIds: Set<string>;
}) {
  return (
    <div className="rounded-xl border border-white/[0.1] bg-neutral-950 p-4">
      <div className="flex flex-wrap gap-1 border-b border-white/[0.1] pb-2">
        {workspaces.map((workspace, index) => (
          <button
            key={workspace.id}
            onClick={() => setSelectedWsIndex(index)}
            className={[
              "rounded-lg px-3 py-1.5 text-sm transition-all",
              index === selectedWsIndex
                ? "bg-white/[0.08] text-white"
                : "text-neutral-500 hover:bg-white/[0.04] hover:text-neutral-200",
              changedWorkspaceIds.has(workspace.id) ? "ring-1 ring-amber-300/40" : "",
            ].join(" ")}
          >
            {workspaceLabel(workspace)}
            <span className={`ml-2 inline-block h-2 w-2 rounded-full ${STATUS_DOT[workspace.status] || STATUS_DOT.offline}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkspacePanel({
  workspace,
  selectedWsIndex,
  changedSurfaceIds,
}: {
  workspace: WorkspaceRuntime;
  selectedWsIndex: number;
  changedSurfaceIds: Set<string>;
}) {
  const surfaces = workspace.surfaces || [];

  return (
    <section className="rounded-xl border border-white/[0.1] bg-neutral-950 p-4">
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">{workspace.name || `Workspace ${selectedWsIndex + 1}`}</h3>
          <p className="text-xs text-neutral-500">
            {workspace.role} · {surfaces.length} surface{surfaces.length === 1 ? "" : "s"} · synced{" "}
            {timeAgo(workspace.last_sync_at)}
          </p>
        </div>
        <div className="text-xs text-neutral-500">
          <span className="font-mono">{workspace.workspace_id || workspace.id}</span>
        </div>
      </div>

      {surfaces.length === 0 ? (
        <EmptyState
          title="No surfaces reported"
          description="This workspace is connected, but no cmux surfaces have been reported yet."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {surfaces.map((surface) => (
            <SurfaceCard
              key={surface.id}
              surface={surface}
              changed={changedSurfaceIds.has(surface.id)}
              workerId={workspace.worker_id}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function AgentsPage() {
  const [workers, setWorkers] = useState<WorkerRuntime[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRuntime[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const [selectedWsIndex, setSelectedWsIndex] = useState(0);
  const [changedWorkerIds, setChangedWorkerIds] = useState<Set<string>>(new Set());
  const [changedWorkspaceIds, setChangedWorkspaceIds] = useState<Set<string>>(new Set());
  const [changedSurfaceIds, setChangedSurfaceIds] = useState<Set<string>>(new Set());
  const workerSnapshotRef = useRef<Map<string, string>>(new Map());
  const workspaceSnapshotRef = useRef<Map<string, string>>(new Map());
  const surfaceSnapshotRef = useRef<Map<string, string>>(new Map());
  const clearHighlightRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (workspaces.length === 0) {
      setSelectedWsIndex(0);
      return;
    }

    setSelectedWsIndex((current) => Math.min(current, workspaces.length - 1));
  }, [workspaces]);

  useEffect(() => {
    async function refresh() {
      try {
        const [nextWorkers, nextWorkspaces] = await Promise.all([cp.workers(), cp.workspaces()]);
        const hydratedWorkspaces = await Promise.all(
          nextWorkspaces.map(async (workspace) => {
            try {
              const surfaces = await cp.surfaces(workspace.id);
              return { ...workspace, surfaces };
            } catch {
              return { ...workspace, surfaces: workspace.surfaces || [] };
            }
          }),
        );

        const nextWorkerSnapshots = new Map<string, string>();
        const nextWorkspaceSnapshots = new Map<string, string>();
        const nextSurfaceSnapshots = new Map<string, string>();
        const workerChanges = new Set<string>();
        const workspaceChanges = new Set<string>();
        const surfaceChanges = new Set<string>();

        for (const worker of nextWorkers) {
          const snapshot = serializeWorker(worker);
          nextWorkerSnapshots.set(worker.worker_id, snapshot);
          if (workerSnapshotRef.current.get(worker.worker_id) !== snapshot) workerChanges.add(worker.worker_id);
        }

        for (const workspace of hydratedWorkspaces) {
          const workspaceSnapshot = serializeWorkspace(workspace);
          nextWorkspaceSnapshots.set(workspace.id, workspaceSnapshot);
          if (workspaceSnapshotRef.current.get(workspace.id) !== workspaceSnapshot) workspaceChanges.add(workspace.id);

          for (const surface of workspace.surfaces || []) {
            const surfaceSnapshot = serializeSurface(surface);
            nextSurfaceSnapshots.set(surface.id, surfaceSnapshot);
            if (surfaceSnapshotRef.current.get(surface.id) !== surfaceSnapshot) surfaceChanges.add(surface.id);
          }
        }

        workerSnapshotRef.current = nextWorkerSnapshots;
        workspaceSnapshotRef.current = nextWorkspaceSnapshots;
        surfaceSnapshotRef.current = nextSurfaceSnapshots;

        if (clearHighlightRef.current) clearTimeout(clearHighlightRef.current);

        startTransition(() => {
          setWorkers(nextWorkers);
          setWorkspaces(hydratedWorkspaces);
          setLastUpdatedAt(new Date());
          setError(null);
          setLoading(false);
          setChangedWorkerIds(workerChanges);
          setChangedWorkspaceIds(workspaceChanges);
          setChangedSurfaceIds(surfaceChanges);
        });

        clearHighlightRef.current = setTimeout(() => {
          setChangedWorkerIds(new Set());
          setChangedWorkspaceIds(new Set());
          setChangedSurfaceIds(new Set());
        }, HIGHLIGHT_DURATION_MS);
      } catch (refreshError) {
        setLoading(false);
        setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh runtime state");
      }
    }

    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      if (clearHighlightRef.current) clearTimeout(clearHighlightRef.current);
    };
  }, []);

  const workerWorkspaceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const workspace of workspaces) {
      counts.set(workspace.worker_id, (counts.get(workspace.worker_id) || 0) + 1);
    }
    return counts;
  }, [workspaces]);

  const workerSurfaceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const workspace of workspaces) {
      counts.set(
        workspace.worker_id,
        (counts.get(workspace.worker_id) || 0) + (workspace.surfaces?.length || 0),
      );
    }
    return counts;
  }, [workspaces]);

  const totalSurfaces = useMemo(
    () => workspaces.reduce((sum, workspace) => sum + (workspace.surfaces?.length || 0), 0),
    [workspaces],
  );

  const visibleWorkspaces = workspaces.filter(ws => (ws.surfaces?.length ?? 0) > 0);
  const selectedWorkspace = visibleWorkspaces[selectedWsIndex];

  void tick;

  if (loading) return <LoadingShell />;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Runtime</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Live view of workers and surface output across connected cmux workspaces.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
          updated {lastUpdatedAt ? timeAgo(lastUpdatedAt) : "—"}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          Runtime refresh error: {error}
        </div>
      ) : null}

      {workers.length === 0 ? (
        <EmptyState
          title="No workers connected"
          description="Start a daemon-mode local agent to publish worker heartbeats and cmux runtime snapshots."
        />
      ) : (
        <section className="space-y-3">
          {workers.map((worker) => (
            <WorkerCard
              key={worker.worker_id}
              worker={worker}
              changed={changedWorkerIds.has(worker.worker_id)}
              workspaceCount={workerWorkspaceCounts.get(worker.worker_id) || 0}
              surfaceCount={workerSurfaceCounts.get(worker.worker_id) || 0}
            />
          ))}
        </section>
      )}

      {workspaces.length === 0 ? (
        <EmptyState
          title="No workspaces reported"
          description="Workspaces appear after a connected worker publishes its cmux snapshot."
        />
      ) : (
        <section className="space-y-4">
          <WorkspaceTabs
            workspaces={visibleWorkspaces}
            selectedWsIndex={selectedWsIndex}
            setSelectedWsIndex={setSelectedWsIndex}
            changedWorkspaceIds={changedWorkspaceIds}
          />
          {selectedWorkspace ? (
            <WorkspacePanel
              workspace={selectedWorkspace}
              selectedWsIndex={selectedWsIndex}
              changedSurfaceIds={changedSurfaceIds}
            />
          ) : null}
          <div className="text-xs text-neutral-500">
            total {workspaces.length} workspaces · {totalSurfaces} surfaces
          </div>
        </section>
      )}
    </div>
  );
}
