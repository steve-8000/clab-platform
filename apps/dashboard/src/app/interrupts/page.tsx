"use client";
import { useState } from "react";
import { useInterrupts } from "@/hooks/use-control-plane";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

export default function InterruptsPage() {
  const { interrupts, loading, resolve } = useInterrupts();
  const [resolveValues, setResolveValues] = useState<Record<string, string>>({});

  const pending = interrupts.filter((i) => i.status === "pending");
  const resolved = interrupts.filter((i) => i.status === "resolved");

  const handleResolve = async (id: string) => {
    const value = resolveValues[id] || "approved";
    await resolve(id, value);
    setResolveValues((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Interrupts</h1>

      {/* Pending */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-amber-400">
          Pending ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <EmptyState title="No pending interrupts" description="Agents will create interrupts when human input is needed" />
        ) : (
          <div className="space-y-3">
            {pending.map((intr) => (
              <div
                key={intr.id}
                className="rounded-lg border border-amber-800 bg-amber-950/20 p-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{intr.value}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Thread: {intr.thread_id?.slice(0, 8)} | {new Date(intr.created_at).toLocaleString()}
                    </p>
                  </div>
                  <StatusBadge status={intr.status} />
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={resolveValues[intr.id] || ""}
                    onChange={(e) => setResolveValues((prev) => ({ ...prev, [intr.id]: e.target.value }))}
                    placeholder="Resume value..."
                    className="flex-1 rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:border-amber-600 focus:outline-none"
                  />
                  <button
                    onClick={() => handleResolve(intr.id)}
                    className="rounded bg-amber-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-600 transition-colors"
                  >
                    Resolve
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resolved */}
      {resolved.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-gray-400">
            Resolved ({resolved.length})
          </h2>
          <div className="space-y-2">
            {resolved.map((intr) => (
              <div
                key={intr.id}
                className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-4 py-3"
              >
                <div>
                  <p className="text-sm text-gray-400">{intr.value}</p>
                  <p className="text-xs text-gray-600">
                    Resume: {intr.resume_value || "—"}
                  </p>
                </div>
                <div className="text-right text-xs text-gray-500">
                  <StatusBadge status={intr.status} />
                  <p className="mt-1">{intr.resolved_at ? new Date(intr.resolved_at).toLocaleString() : ""}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
