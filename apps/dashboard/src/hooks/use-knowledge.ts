"use client";
import { useEffect, useState, useCallback } from "react";
import { ks } from "@/lib/api";
import type { GraphData, InsightListResponse, KnowledgeEntry, ProfileResponse } from "@/types";

export function useKnowledgeSearch(query: string) {
  const [results, setResults] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const data = await ks.search(q);
      setResults(Array.isArray(data) ? data : (data.results || []));
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

export function useProfile() {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ks.profile();
      setProfile(data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { profile, loading, refresh };
}

export function useGraph() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ks.graph();
      setGraph(data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { graph, loading, refresh };
}

export function useInsightsList(type?: string) {
  const [insights, setInsights] = useState<InsightListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ks.insightsList(type);
      setInsights(data);
    } catch {}
    setLoading(false);
  }, [type]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { insights, loading, refresh };
}
