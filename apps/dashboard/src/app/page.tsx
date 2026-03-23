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
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Real-time system overview — threads, agents, and interrupts at a glance.
        </p>
      </div>

      <StatCards data={health} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Threads */}
        <div className="rounded-lg border border-white/[0.06] bg-neutral-950 p-4">
          <h3 className="mb-1 text-sm font-medium text-neutral-400">Recent Threads ({threads.length})</h3>
          <p className="mb-3 text-xs text-neutral-500">Latest mission threads created by connected agents.</p>
          <div className="space-y-2">
            {recentThreads.length === 0 ? (
              <p className="text-xs text-neutral-600">
                No threads yet — threads are created when agents start executing missions.
              </p>
            ) : (
              recentThreads.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedThread(t.id)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    selectedThread === t.id ? "bg-white/[0.06]" : "hover:bg-white/[0.06]/50"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.goal || t.id.slice(0, 8)}</p>
                    <p className="text-xs text-neutral-500">{t.workdir}</p>
                  </div>
                  <StatusBadge status={t.status} />
                </button>
              ))
            )}
          </div>
        </div>

        {/* Live Events */}
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-medium text-neutral-400">Live Event Stream</h3>
            <p className="text-xs text-neutral-500">Select a thread from the list to see its live event stream.</p>
          </div>
          <LiveEvents threadId={selectedThread} />
        </div>
      </div>

      {/* Pending Interrupts */}
      {pendingInterrupts.length > 0 && (
        <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-4">
          <h3 className="mb-3 text-sm font-medium text-amber-400">
            ⚠ Pending Interrupts ({pendingInterrupts.length})
          </h3>
          <div className="space-y-2">
            {pendingInterrupts.map((intr) => (
              <div key={intr.id} className="flex items-center justify-between rounded bg-neutral-950 px-3 py-2">
                <div>
                  <p className="text-sm">{intr.value}</p>
                  <p className="text-xs text-neutral-500">Thread: {intr.thread_id?.slice(0, 8)}</p>
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
