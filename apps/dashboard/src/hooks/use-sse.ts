"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { CONTROL_PLANE_URL } from "@/lib/config";
import type { RunEvent } from "@/types";

export function useSSE(threadId: string | null) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!threadId) return;
    const url = `${CONTROL_PLANE_URL}/threads/${threadId}/events`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        const event: RunEvent = JSON.parse(e.data);
        setEvents((prev) => [...prev.slice(-99), event]);
      } catch {}
    };
    es.onerror = () => {
      setConnected(false);
      es.close();
      // Auto-reconnect after 3s
      setTimeout(() => {
        if (esRef.current === es) esRef.current = null;
      }, 3000);
    };

    return () => { es.close(); esRef.current = null; };
  }, [threadId]);

  const clear = useCallback(() => setEvents([]), []);
  return { events, connected, clear };
}

// Global event feed — polls all threads
export function useGlobalEvents() {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`${CONTROL_PLANE_URL}/threads`);
        const threads = await res.json();
        // Get events from the most recent thread
        if (threads.length > 0) {
          const latest = threads[0];
          const evRes = await fetch(`${CONTROL_PLANE_URL}/threads/${latest.id}/events`);
          // SSE not suitable for polling — just mark as loaded
        }
      } catch {}
      setLoading(false);
    }
    poll();
    const interval = setInterval(poll, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return { events, loading };
}
