"use client";
import { useThreads } from "@/hooks/use-control-plane";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export default function ThreadsPage() {
  const { threads, loading } = useThreads();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Threads & Runs</h1>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : threads.length === 0 ? (
        <EmptyState title="No threads" description="Threads will appear when agents start executing" />
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <p className="font-mono text-sm text-gray-300">{t.id.slice(0, 8)}</p>
                  <StatusBadge status={t.status} />
                </div>
                <p className="mt-1 text-sm text-gray-400">{t.goal || "—"}</p>
                <p className="text-xs text-gray-600">{t.workdir}</p>
              </div>
              <div className="text-right text-xs text-gray-500">
                <p>{new Date(t.created_at).toLocaleString()}</p>
                <p>worker: {t.worker_id || "—"}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
