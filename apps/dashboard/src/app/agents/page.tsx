"use client";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { CmuxWorkspace } from "@/types";
import { CONTROL_PLANE_URL } from "@/lib/config";

export default function AgentsPage() {
  const [workspaces, setWorkspaces] = useState<CmuxWorkspace[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${CONTROL_PLANE_URL}/workers`);
        const data = await res.json();
        setWorkers(data || []);
      } catch {}
      setLoading(false);
    }
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Agents</h1>
      <p className="text-sm text-gray-500">
        cmux workspaces and registered workers
      </p>

      {/* Workers from Control Plane */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-gray-300">Registered Workers</h2>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-800" />
            ))}
          </div>
        ) : workers.length === 0 ? (
          <EmptyState title="No workers connected" description="Workers register via WebSocket at /ws/worker" />
        ) : (
          <div className="space-y-2">
            {workers.map((w: any, i: number) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-4 py-3"
              >
                <div>
                  <p className="font-mono text-sm">{w.worker_id}</p>
                  <p className="text-xs text-gray-500">
                    caps: {(w.capabilities || []).join(", ") || "none"}
                  </p>
                </div>
                <div className="text-right text-xs text-gray-500">
                  <p>{w.workdir || "—"}</p>
                  <StatusBadge status="ACTIVE" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* cmux Workspaces (placeholder — populated when cmux reports to control plane) */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-gray-300">cmux Workspaces</h2>
        <EmptyState
          title="cmux workspace data"
          description="Workspace/surface state will appear when agents report via CmuxRuntime"
        />
      </div>
    </div>
  );
}
