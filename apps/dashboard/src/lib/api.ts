import type {
  DashboardData,
  Mission,
  Session,
  KnowledgeEntry,
  Insight,
  MissionStatus,
  MissionPriority,
  SessionState,
  KnowledgeSource,
} from "@/types";

// Re-export types for backward compatibility
export type { DashboardData, KnowledgeEntry, Insight as InsightEntry, PipelineStats } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://api-gateway:4000";

// -- Helper --

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// -- Dashboard --

export async function fetchDashboard(): Promise<DashboardData> {
  return apiFetch<DashboardData>("/v1/dashboard");
}

// -- Missions --

export interface MissionFilters {
  status?: MissionStatus;
  priority?: MissionPriority;
}

export async function fetchMissions(filters?: MissionFilters): Promise<Mission[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.priority) params.set("priority", filters.priority);
  const qs = params.toString();
  return apiFetch<Mission[]>(`/v1/missions${qs ? `?${qs}` : ""}`);
}

export async function fetchMission(id: string): Promise<Mission> {
  return apiFetch<Mission>(`/v1/missions/${id}`);
}

export async function startMission(id: string): Promise<Mission> {
  return apiFetch<Mission>(`/v1/missions/${id}/start`, { method: "POST" });
}

export async function abortMission(id: string): Promise<Mission> {
  return apiFetch<Mission>(`/v1/missions/${id}/abort`, { method: "POST" });
}

// -- Sessions --

export interface SessionFilters {
  state?: SessionState;
}

export async function fetchSessions(filters?: SessionFilters): Promise<Session[]> {
  const params = new URLSearchParams();
  if (filters?.state) params.set("state", filters.state);
  const qs = params.toString();
  return apiFetch<Session[]>(`/v1/sessions${qs ? `?${qs}` : ""}`);
}

// -- Knowledge --

export interface KnowledgeFilters {
  query?: string;
  source?: KnowledgeSource;
  tags?: string[];
}

export async function fetchKnowledge(filters?: KnowledgeFilters): Promise<KnowledgeEntry[]> {
  const params = new URLSearchParams();
  if (filters?.query) params.set("q", filters.query);
  if (filters?.source) params.set("source", filters.source);
  if (filters?.tags?.length) params.set("tags", filters.tags.join(","));
  const qs = params.toString();
  return apiFetch<KnowledgeEntry[]>(`/v1/knowledge/search${qs ? `?${qs}` : ""}`);
}

export async function fetchInsights(): Promise<Insight[]> {
  return apiFetch<Insight[]>("/v1/insights");
}
