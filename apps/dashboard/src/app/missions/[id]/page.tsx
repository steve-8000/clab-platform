"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Mission } from "@/types";
import { StatusBadge } from "@/components/ui/status-badge";
import { WaveTimeline } from "@/components/missions/wave-timeline";
import { TaskTable } from "@/components/missions/task-table";
import { Skeleton } from "@/components/ui/skeleton";

export default function MissionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [mission, setMission] = useState<Mission | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchMission = useCallback(async () => {
    try {
      const res = await fetch(`/api/missions/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMission(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load mission");
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchMission();
    const interval = setInterval(fetchMission, 5000);
    return () => clearInterval(interval);
  }, [fetchMission]);

  async function handleAction(action: "start" | "abort") {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/missions/${id}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error(`Action failed: ${res.status}`);
      await fetchMission();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} mission`);
    } finally {
      setActionLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error && !mission) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.back()} className="text-sm text-blue-400 hover:text-blue-300">&larr; Back</button>
        <div className="text-red-400 bg-red-900/20 border border-red-800 rounded-lg p-4">{error}</div>
      </div>
    );
  }

  if (!mission) return null;

  const waves = mission.plan?.waves ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button onClick={() => router.back()} className="text-xs text-blue-400 hover:text-blue-300 mb-2 block">&larr; Back to Missions</button>
          <h2 className="text-xl font-bold text-gray-100">{mission.title}</h2>
          {mission.objective && (
            <p className="text-sm text-gray-400 mt-1 max-w-2xl">{mission.objective}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {mission.status === "PLANNED" && (
            <button
              onClick={() => handleAction("start")}
              disabled={actionLoading}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {actionLoading ? "Starting..." : "Start Mission"}
            </button>
          )}
          {mission.status === "RUNNING" && (
            <button
              onClick={() => handleAction("abort")}
              disabled={actionLoading}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {actionLoading ? "Aborting..." : "Abort Mission"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg p-3">{error}</div>
      )}

      {/* Mission Info */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-5">
        <h3 className="text-sm font-medium text-gray-400 mb-3">Mission Details</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500 mb-1">Status</p>
            <StatusBadge status={mission.status} size="md" />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Priority</p>
            <StatusBadge status={mission.priority} size="md" />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Created</p>
            <p className="text-sm text-gray-200">{new Date(mission.createdAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Completed</p>
            <p className="text-sm text-gray-200">
              {mission.completedAt ? new Date(mission.completedAt).toLocaleString() : "--"}
            </p>
          </div>
        </div>
      </div>

      {/* Wave Timeline */}
      {waves.length > 0 && (
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-5">
          <h3 className="text-sm font-medium text-gray-400 mb-4">Wave Timeline</h3>
          <WaveTimeline waves={waves} />
        </div>
      )}

      {/* Task Tables per Wave */}
      {waves.length > 0 && (
        <div className="space-y-4">
          {waves.map((wave) => (
            <TaskTable key={wave.id} tasks={wave.tasks} waveIndex={wave.index} />
          ))}
        </div>
      )}
    </div>
  );
}
