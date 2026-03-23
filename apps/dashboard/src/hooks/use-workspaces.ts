"use client";

import { useCallback, useEffect, useState } from "react";
import { cp } from "@/lib/api";
import type { DispatchCommand, WorkspaceRuntime } from "@/types";

export function useWorkspaces(workerId?: string) {
  const [workspaces, setWorkspaces] = useState<WorkspaceRuntime[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setWorkspaces(await cp.workspaces(workerId));
    } catch {
      setWorkspaces([]);
    } finally {
      setLoading(false);
    }
  }, [workerId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { workspaces, loading, refresh };
}

export function useWorkspaceDetail(workspaceId: string | null) {
  const [workspace, setWorkspace] = useState<WorkspaceRuntime | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setWorkspace(null);
      setLoading(false);
      return;
    }

    try {
      setWorkspace(await cp.workspace(workspaceId));
    } catch {
      setWorkspace(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { workspace, loading, refresh };
}

export function useDispatches(workerId?: string) {
  const [dispatches, setDispatches] = useState<DispatchCommand[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setDispatches(await cp.dispatches(workerId));
    } catch {
      setDispatches([]);
    } finally {
      setLoading(false);
    }
  }, [workerId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { dispatches, loading, refresh };
}

export function useRuntimeSSE(workerId?: string) {
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const url = cp.runtimeEventsUrl(workerId);
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>;
        setEvents((prev) => [...prev.slice(-99), data]);
      } catch {}
    };
    es.onerror = () => {
      setConnected(false);
      setTimeout(() => es.close(), 3000);
    };

    return () => es.close();
  }, [workerId]);

  return { events, connected };
}
