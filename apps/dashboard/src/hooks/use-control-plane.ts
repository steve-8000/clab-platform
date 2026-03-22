"use client";
import { useEffect, useState, useCallback } from "react";
import { cp } from "@/lib/api";
import type { HealthData, Thread, Interrupt } from "@/types";

export function useHealth() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const health = await cp.health();
      setData(health);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { refresh(); const i = setInterval(refresh, 10000); return () => clearInterval(i); }, [refresh]);
  return { data, error, refresh };
}

export function useThreads(status?: string) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await cp.threads(status);
      setThreads(data);
    } catch {}
    setLoading(false);
  }, [status]);

  useEffect(() => { refresh(); const i = setInterval(refresh, 5000); return () => clearInterval(i); }, [refresh]);
  return { threads, loading, refresh };
}

export function useInterrupts() {
  const [interrupts, setInterrupts] = useState<Interrupt[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await cp.interrupts();
      setInterrupts(data);
    } catch {}
    setLoading(false);
  }, []);

  const resolve = useCallback(async (id: string, resumeValue: string) => {
    await cp.resolveInterrupt(id, resumeValue);
    await refresh();
  }, [refresh]);

  useEffect(() => { refresh(); const i = setInterval(refresh, 5000); return () => clearInterval(i); }, [refresh]);
  return { interrupts, loading, refresh, resolve };
}
