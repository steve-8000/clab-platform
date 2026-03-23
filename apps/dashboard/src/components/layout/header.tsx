"use client";

import { useHealth } from "@/hooks/use-control-plane";

type HeaderProps = {
  onMenuClick: () => void;
};

export function Header({ onMenuClick }: HeaderProps) {
  const { data, error, refresh } = useHealth();
  const isOnline = Boolean(data) && !error;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/[0.06] bg-black/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Open navigation menu"
          onClick={onMenuClick}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.06] text-neutral-400 transition-colors hover:text-white lg:hidden"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-neutral-600">Operations</p>
          <div className="mt-1 flex items-center gap-3">
            <h2 className="text-sm font-medium text-white sm:text-base">System Status</h2>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-xs text-neutral-400">
              <span
                className={`h-2 w-2 rounded-full ${
                  data === undefined ? "bg-neutral-500 animate-pulse" : isOnline ? "bg-emerald-400" : "bg-red-400"
                }`}
              />
              {data === undefined ? "connecting" : isOnline ? data?.status ?? "ok" : "offline"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-neutral-400">
        {data && (
          <>
            <span className="hidden rounded-full border border-white/[0.06] px-3 py-1 sm:inline-flex">
              {data.threads} threads
            </span>
            <span className="hidden rounded-full border border-white/[0.06] px-3 py-1 md:inline-flex">
              {data.runs} runs
            </span>
            <span className="rounded-full border border-white/[0.06] px-3 py-1">
              {data.workers} workers
            </span>
            {data.pending_interrupts > 0 && (
              <span className="rounded-full border border-white/[0.06] bg-white/[0.05] px-3 py-1 text-white">
                {data.pending_interrupts} interrupts
              </span>
            )}
          </>
        )}

        <button
          type="button"
          onClick={refresh}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.06] text-neutral-400 transition-colors hover:text-white"
          aria-label="Refresh health"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
            <path d="M20 12a8 8 0 10-2.34 5.66M20 4v8h-8" />
          </svg>
        </button>
      </div>
    </header>
  );
}
