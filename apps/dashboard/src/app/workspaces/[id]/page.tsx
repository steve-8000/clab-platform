"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { cp } from "@/lib/api";
import { useDispatches, useRuntimeSSE, useWorkspaceDetail } from "@/hooks/use-workspaces";

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const SURFACE_ROLE_STYLES: Record<string, string> = {
  reviewer: "bg-blue-900 text-blue-300",
  worker: "bg-green-900 text-green-300",
  browser: "bg-purple-900 text-purple-300",
  planner: "bg-amber-900 text-amber-300",
  shell: "bg-white/[0.08] text-neutral-300",
};

export default function WorkspaceDetailPage() {
  const params = useParams<{ id: string }>();
  const workspaceId = typeof params.id === "string" ? params.id : null;
  const { workspace, loading, refresh } = useWorkspaceDetail(workspaceId);
  const { dispatches, refresh: refreshDispatches } = useDispatches(workspace?.worker_id);
  const { events, connected } = useRuntimeSSE(workspace?.worker_id);
  const [goal, setGoal] = useState("");
  const [workdir, setWorkdir] = useState(".");
  const [parallel, setParallel] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});

  const recentDispatches = useMemo(() => {
    return dispatches
      .filter((dispatch) => !workspace || dispatch.workspace_id === workspace.id || !dispatch.workspace_id)
      .slice(0, 10);
  }, [dispatches, workspace]);

  async function handleMissionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !goal.trim()) return;

    setPendingAction("mission");
    try {
      await cp.dispatchMission({
        worker_id: workspace.worker_id,
        goal: goal.trim(),
        workdir: workdir.trim() || ".",
        parallel,
        workspace_id: workspace.id,
      });
      setGoal("");
      await Promise.all([refresh(), refreshDispatches()]);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCancel() {
    if (!workspace) return;

    setPendingAction("cancel");
    try {
      await cp.dispatchCancel({ worker_id: workspace.worker_id, workspace_id: workspace.id });
      await refreshDispatches();
    } finally {
      setPendingAction(null);
    }
  }

  async function handlePrompt(surfaceId: string) {
    const prompt = promptDrafts[surfaceId]?.trim();
    if (!workspace || !prompt) return;

    setPendingAction(`prompt:${surfaceId}`);
    try {
      await cp.dispatchPrompt({
        worker_id: workspace.worker_id,
        workspace_id: workspace.id,
        surface_id: surfaceId,
        prompt,
      });
      setPromptDrafts((prev) => ({ ...prev, [surfaceId]: "" }));
      await refreshDispatches();
    } finally {
      setPendingAction(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-20 animate-pulse rounded-lg bg-neutral-950" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-64 animate-pulse rounded-lg bg-neutral-950" />
          ))}
        </div>
      </div>
    );
  }

  if (!workspace) {
    return <EmptyState title="Workspace not found" description="The selected workspace is unavailable or has not reported runtime state." />;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-white/[0.06] bg-neutral-950 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{workspace.name}</h1>
              <StatusBadge status={workspace.status} />
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-neutral-300">{workspace.role}</span>
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm text-neutral-400 md:grid-cols-2">
              <p>worker: {workspace.worker_id}</p>
              <p>workspace: {workspace.workspace_id}</p>
              <p>
                thread:{" "}
                {workspace.current_thread_id ? (
                  <Link href="/threads" className="text-blue-400 hover:text-blue-300">
                    {workspace.current_thread_id}
                  </Link>
                ) : (
                  "—"
                )}
              </p>
              <p>run: {workspace.current_run_id || "—"}</p>
              <p>last sync: {formatDate(workspace.last_sync_at)}</p>
              <p>runtime SSE: {connected ? "connected" : "disconnected"}</p>
            </div>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-black px-4 py-3 text-sm text-neutral-400">
            <p>{events.length} recent runtime events buffered</p>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-neutral-200">Surfaces</h2>
        {(workspace.surfaces || []).length === 0 ? (
          <EmptyState
            title="No surfaces reported"
            description="No surfaces in this workspace. Surfaces are created when the agent splits panes for codex/claude workers."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <p className="text-sm text-neutral-500 md:col-span-2 lg:col-span-3">
              Each surface represents one pane or worker context inside this workspace.
            </p>
            {(workspace.surfaces || []).map((surface) => (
              <div key={surface.id} className="rounded-lg border border-white/[0.06] bg-neutral-950 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-white">{surface.name}</h3>
                    <p className="mt-1 font-mono text-xs text-neutral-500">{surface.surface_id}</p>
                  </div>
                  <StatusBadge status={surface.status} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      SURFACE_ROLE_STYLES[surface.role] || "bg-white/[0.08] text-neutral-300"
                    }`}
                  >
                    {surface.role}
                  </span>
                  <span className="rounded-full bg-black px-2 py-0.5 text-xs text-neutral-300">{surface.engine}</span>
                </div>
                <div className="mt-4 rounded-lg bg-black p-3">
                  <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs text-neutral-300">
                    {surface.last_output_excerpt || "No output excerpt"}
                  </pre>
                </div>
                <p className="mt-3 text-xs text-neutral-500">last activity: {formatDate(surface.last_activity_at)}</p>
                <div className="mt-4 space-y-2">
                  <textarea
                    value={promptDrafts[surface.surface_id] || ""}
                    onChange={(event) =>
                      setPromptDrafts((prev) => ({ ...prev, [surface.surface_id]: event.target.value }))
                    }
                    rows={3}
                    placeholder="Send prompt to this surface..."
                    className="w-full rounded-lg border border-white/[0.06] bg-black px-3 py-2 text-sm text-white placeholder-neutral-600 focus:border-blue-500/50 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handlePrompt(surface.surface_id)}
                    disabled={pendingAction === `prompt:${surface.surface_id}`}
                    className="rounded-lg border border-white/[0.1] px-3 py-2 text-sm font-medium text-neutral-200 transition-colors hover:border-white/[0.1] hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Send Prompt
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <form onSubmit={handleMissionSubmit} className="rounded-lg border border-white/[0.06] bg-neutral-950 p-5">
          <h2 className="text-lg font-semibold text-white">Dispatch Mission</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Send a mission goal to this workspace&apos;s worker, or inject a prompt directly into a specific surface.
          </p>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-2 block text-sm text-neutral-400">Goal</label>
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                rows={4}
                className="w-full rounded-lg border border-white/[0.06] bg-black px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-neutral-400">Workdir</label>
              <input
                value={workdir}
                onChange={(event) => setWorkdir(event.target.value)}
                className="w-full rounded-lg border border-white/[0.06] bg-black px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={parallel}
                onChange={(event) => setParallel(event.target.checked)}
                className="h-4 w-4 rounded border-white/[0.1] bg-black text-blue-500 focus:ring-blue-500"
              />
              Parallel execution
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={!goal.trim() || pendingAction === "mission"}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Send
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={pendingAction === "cancel"}
                className="rounded-lg border border-red-800 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>

        <div className="rounded-lg border border-white/[0.06] bg-neutral-950 p-5">
          <h2 className="text-lg font-semibold text-white">Recent Dispatches</h2>
          {recentDispatches.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="No recent dispatches" description="No dispatches yet. Use the form above to send a mission or prompt." />
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-neutral-500">Recent dispatches show the latest mission, prompt, and cancel commands sent to this workspace.</p>
              {recentDispatches.map((dispatch) => (
                <div key={dispatch.id} className="rounded-lg border border-white/[0.06] bg-black p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-neutral-200">{dispatch.command_type}</span>
                    <StatusBadge status={dispatch.status} />
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">{formatDate(dispatch.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
