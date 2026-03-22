"use client";
import { useEffect, useState, useCallback } from "react";
import { ks } from "@/lib/api";
import type { KnowledgeEntry } from "@/types";

export function useKnowledgeSearch(query: string) {
  const [results, setResults] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const data = await ks.search(q);
      setResults(data.entries || data.results || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  return { results, loading };
}

export function useKnowledgeStatus() {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    ks.status().then(setStatus).catch(() => {});
    const i = setInterval(() => ks.status().then(setStatus).catch(() => {}), 30000);
    return () => clearInterval(i);
  }, []);

  return status;
}
