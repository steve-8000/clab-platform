"use client";
import { useState } from "react";
import { useSSE } from "@/hooks/use-sse";
import type { RunEvent } from "@/types";

const EVENT_COLORS: Record<string, string> = {
  "thread.created": "text-blue-400",
  "run.created": "text-indigo-400",
  "run.updated": "text-purple-400",
  "run.state_update": "text-cyan-400",
  "interrupt.created": "text-amber-400",
  "interrupt.resolved": "text-green-400",
  "checkpoint.saved": "text-emerald-400",
  "artifact.recorded": "text-teal-400",
  "session.created": "text-blue-300",
  "session.updated": "text-blue-200",
};

export function LiveEvents({ threadId }: { threadId: string | null }) {
  const { events, connected, clear } = useSSE(threadId);

  if (!threadId) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-neutral-950 p-4">
        <h3 className="mb-3 text-sm font-medium text-neutral-400">Live Events</h3>
        <p className="text-xs text-neutral-600">Select a thread to stream events</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/[0.06] bg-neutral-950 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-400">Live Events</h3>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-xs text-neutral-500">{connected ? "connected" : "disconnected"}</span>
          {events.length > 0 && (
            <button onClick={clear} className="text-xs text-neutral-500 hover:text-neutral-300">clear</button>
          )}
        </div>
      </div>
      <div className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs">
        {events.length === 0 ? (
          <p className="text-neutral-600">Waiting for events...</p>
        ) : (
          events.map((evt, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-neutral-600 shrink-0">{evt.seq}</span>
              <span className={EVENT_COLORS[evt.type] || "text-neutral-400"}>{evt.type}</span>
              <span className="text-neutral-600 truncate">{JSON.stringify(evt.payload)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
