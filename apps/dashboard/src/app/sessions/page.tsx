"use client";

import { useState, useEffect, useCallback } from "react";
import type { Session, SessionState } from "@/types";
import { StatusBadge } from "@/components/ui/status-badge";
import { ListSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

const STATES: (SessionState | "ALL")[] = ["ALL", "IDLE", "RUNNING", "STALE", "CLOSED"];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<SessionState | "ALL">("ALL");

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (stateFilter !== "ALL") params.set("state", stateFilter);
      const qs = params.toString();
      const res = await fetch(`/api/sessions${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessions(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setIsLoading(false);
    }
  }, [stateFilter]);

  useEffect(() => {
    setIsLoading(true);
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Client-side filtering as fallback
  const filtered = sessions.filter((s) => {
    if (stateFilter !== "ALL" && s.state !== stateFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-100">Sessions</h2>
        <span className="text-xs text-gray-500">{filtered.length} session{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">State:</span>
        <div className="flex gap-1">
          {STATES.map((s) => (
            <button
              key={s}
              onClick={() => setStateFilter(s)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                stateFilter === s
                  ? "bg-blue-600/30 text-blue-300 border border-blue-600/40"
                  : "bg-gray-800 text-gray-400 border border-gray-700 hover:text-gray-300"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg p-3">{error}</div>
      )}

      {isLoading ? (
        <ListSkeleton rows={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={"\u25C9"}
          title="No sessions found"
          description="No sessions match the current filter."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((s) => (
            <div
              key={s.id}
              className="bg-gray-900 rounded-lg border border-gray-800 p-4 hover:border-gray-700 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-gray-100">{s.role}</p>
                  <p className="text-xs text-gray-500">{s.engine}</p>
                </div>
                <StatusBadge status={s.state} />
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-gray-400">
                  <span>Last heartbeat</span>
                  <span className="text-gray-300">
                    {s.lastHeartbeat ? timeAgo(s.lastHeartbeat) : "--"}
                  </span>
                </div>
                {s.taskId && (
                  <div className="flex justify-between text-gray-400">
                    <span>Current task</span>
                    <span className="text-gray-300 font-mono truncate ml-2 max-w-[120px]">{s.taskId}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-400">
                  <span>Created</span>
                  <span className="text-gray-300">{timeAgo(s.createdAt)}</span>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-gray-800">
                <p className="text-[10px] text-gray-600 font-mono truncate">{s.id}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
