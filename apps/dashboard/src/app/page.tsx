"use client";
import { useState } from "react";
import { useHealth, useThreads, useInterrupts } from "@/hooks/use-control-plane";
import { StatCards } from "@/components/dashboard/stat-cards";
import { LiveEvents } from "@/components/dashboard/live-events";
import { StatusBadge } from "@/components/ui/status-badge";

export default function DashboardPage() {
  const { data: health } = useHealth();
  const { threads } = useThreads();
  const { interrupts } = useInterrupts();
  const [selectedThread, setSelectedThread] = useState<string | null>(null);

  const recentThreads = threads.slice(0, 8);
  const pendingInterrupts = interrupts.filter((i) => i.status === "pending");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <StatCards data={health} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Threads */}
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-gray-400">Recent Threads</h3>
          <div className="space-y-2">
            {recentThreads.length === 0 ? (
              <p className="text-xs text-gray-600">No threads yet</p>
            ) : (
              recentThreads.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedThread(t.id)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    selectedThread === t.id ? "bg-gray-800" : "hover:bg-gray-800/50"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.goal || t.id.slice(0, 8)}</p>
                    <p className="text-xs text-gray-500">{t.workdir}</p>
                  </div>
                  <StatusBadge status={t.status} />
                </button>
              ))
            )}
          </div>
        </div>

        {/* Live Events */}
        <LiveEvents threadId={selectedThread} />
      </div>

      {/* Pending Interrupts */}
      {pendingInterrupts.length > 0 && (
        <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-4">
          <h3 className="mb-3 text-sm font-medium text-amber-400">
            ⚠ Pending Interrupts ({pendingInterrupts.length})
          </h3>
          <div className="space-y-2">
            {pendingInterrupts.map((intr) => (
              <div key={intr.id} className="flex items-center justify-between rounded bg-gray-900 px-3 py-2">
                <div>
                  <p className="text-sm">{intr.value}</p>
                  <p className="text-xs text-gray-500">Thread: {intr.thread_id?.slice(0, 8)}</p>
                </div>
                <StatusBadge status={intr.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
