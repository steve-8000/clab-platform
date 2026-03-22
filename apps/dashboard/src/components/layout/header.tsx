"use client";
import { useHealth } from "@/hooks/use-control-plane";

export function Header() {
  const { data, error, refresh } = useHealth();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gray-800 bg-gray-950/80 px-6 backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-400">Control Plane</span>
        {data ? (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-green-400">{data.status}</span>
          </span>
        ) : error ? (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-red-400">offline</span>
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-4 text-xs text-gray-500">
        {data && (
          <>
            <span>{data.threads} threads</span>
            <span>{data.runs} runs</span>
            <span>{data.workers} workers</span>
            {data.pending_interrupts > 0 && (
              <span className="rounded bg-amber-900 px-1.5 py-0.5 text-amber-300">
                {data.pending_interrupts} interrupts
              </span>
            )}
          </>
        )}
        <button onClick={refresh} className="text-gray-400 hover:text-white transition-colors">↻</button>
      </div>
    </header>
  );
}
