import { CODE_INTEL_URL, CONTROL_PLANE_URL, KNOWLEDGE_URL } from "./config";
import type {
  Artifact,
  HealthData,
  Interrupt,
  Thread,
  WorkerRuntime,
  DispatchCommand,
  GraphData,
  InsightListResponse,
  ProfileResponse,
  SurfaceRuntime,
  WorkspaceRuntime,
} from "@/types";

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ---- Control Plane ----
export const cp = {
  health: () => fetchJSON<HealthData>(`${CONTROL_PLANE_URL}/health`),
  threads: (status?: string) => {
    const qs = status ? `?status=${status}` : "";
    return fetchJSON<Thread[]>(`${CONTROL_PLANE_URL}/threads${qs}`);
  },
  thread: (id: string) => fetchJSON<Thread>(`${CONTROL_PLANE_URL}/threads/${id}`),
  runs: (threadId: string) =>
    fetchJSON<any>(`${CONTROL_PLANE_URL}/threads/${threadId}/runs`, { method: "POST", body: "{}" }),
  run: (id: string) => fetchJSON<any>(`${CONTROL_PLANE_URL}/runs/${id}`),
  interrupts: (threadId?: string) => {
    const qs = threadId ? `?thread_id=${threadId}` : "";
    return fetchJSON<Interrupt[]>(`${CONTROL_PLANE_URL}/interrupts${qs}`);
  },
  resolveInterrupt: (id: string, resumeValue: string) =>
    fetchJSON<any>(`${CONTROL_PLANE_URL}/interrupts/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resume_value: resumeValue }),
    }),
  workers: () => fetchJSON<WorkerRuntime[]>(`${CONTROL_PLANE_URL}/workers`),
  workspaces: (workerId?: string) =>
    fetchJSON<WorkspaceRuntime[]>(
      `${CONTROL_PLANE_URL}/workspaces${workerId ? `?worker_id=${encodeURIComponent(workerId)}` : ""}`,
    ),
  workspace: (workspaceId: string) =>
    fetchJSON<WorkspaceRuntime>(`${CONTROL_PLANE_URL}/workspaces/${workspaceId}`),
  surfaces: (workspaceId: string) =>
    fetchJSON<SurfaceRuntime[]>(`${CONTROL_PLANE_URL}/workspaces/${workspaceId}/surfaces`),
  workerWorkspaces: (workerId: string) =>
    fetchJSON<WorkspaceRuntime[]>(`${CONTROL_PLANE_URL}/workers/${workerId}/workspaces`),
  dispatchMission: (body: {
    worker_id: string;
    goal: string;
    workdir?: string;
    parallel?: boolean;
    workspace_id?: string;
  }) =>
    fetchJSON<DispatchCommand>(`${CONTROL_PLANE_URL}/dispatch/mission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  dispatchPrompt: (body: {
    worker_id: string;
    surface_id: string;
    prompt: string;
    workspace_id?: string;
  }) =>
    fetchJSON<DispatchCommand>(`${CONTROL_PLANE_URL}/dispatch/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  dispatchCancel: (body: { worker_id: string; workspace_id?: string; run_id?: string }) =>
    fetchJSON<DispatchCommand>(`${CONTROL_PLANE_URL}/dispatch/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  dispatches: (workerId?: string, status?: string) => {
    const params = new URLSearchParams();
    if (workerId) params.set("worker_id", workerId);
    if (status) params.set("status", status);
    const qs = params.toString();
    return fetchJSON<DispatchCommand[]>(`${CONTROL_PLANE_URL}/dispatches${qs ? `?${qs}` : ""}`);
  },
  artifacts: (threadId?: string) => {
    const qs = threadId ? `?thread_id=${threadId}` : "";
    return fetchJSON<Artifact[]>(`${CONTROL_PLANE_URL}/artifacts${qs}`);
  },
  eventsUrl: (threadId: string) => `${CONTROL_PLANE_URL}/events/thread/${threadId}`,
  runtimeEventsUrl: (workerId?: string) =>
    `${CONTROL_PLANE_URL}/events/runtime${workerId ? `?worker_id=${encodeURIComponent(workerId)}` : ""}`,
  schedules: (workerId?: string) =>
    fetchJSON<any[]>(`${CONTROL_PLANE_URL}/schedules${workerId ? `?worker_id=${workerId}` : ""}`),
  createSchedule: (body: any) =>
    fetchJSON<any>(`${CONTROL_PLANE_URL}/schedules`, { method: "POST", body: JSON.stringify(body) }),
  updateSchedule: (id: string, body: any) =>
    fetchJSON<any>(`${CONTROL_PLANE_URL}/schedules/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteSchedule: (id: string) =>
    fetchJSON<any>(`${CONTROL_PLANE_URL}/schedules/${id}`, { method: "DELETE" }),
  triggerHeartbeat: (workerId: string) =>
    fetchJSON<any>(`${CONTROL_PLANE_URL}/workers/${workerId}/heartbeat`, { method: "POST" }),
};

// ---- Knowledge Service ----
export const ks = {
  health: () => fetchJSON<any>(`${KNOWLEDGE_URL}/health`),
  search: (q: string, limit = 10) =>
    fetchJSON<any>(`${KNOWLEDGE_URL}/v1/knowledge/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  status: () => fetchJSON<any>(`${KNOWLEDGE_URL}/v1/knowledge/status`),
  tags: () => fetchJSON<any>(`${KNOWLEDGE_URL}/v1/knowledge/tags`),
  profile: () => fetchJSON<ProfileResponse>(`${KNOWLEDGE_URL}/v1/profile`),
  graph: () => fetchJSON<GraphData>(`${KNOWLEDGE_URL}/v1/graph`),
  insightsList: (type?: string) =>
    fetchJSON<InsightListResponse>(
      `${KNOWLEDGE_URL}/v1/insights/list${type ? `?type=${encodeURIComponent(type)}` : ""}`,
    ),
};

// ---- Code Intelligence ----
export const ci = {
  repositories: () => fetchJSON<any>(`${CODE_INTEL_URL}/repositories`),
  repository: (repoId: string) => fetchJSON<any>(`${CODE_INTEL_URL}/repositories/${repoId}`),
  createRepository: (body: { url: string; name: string; default_branch: string }) =>
    fetchJSON<any>(`${CODE_INTEL_URL}/repositories`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteRepository: (repoId: string) =>
    fetchJSON<any>(`${CODE_INTEL_URL}/repositories/${repoId}`, { method: "DELETE" }),
  summary: (repoId: string) => fetchJSON<any>(`${CODE_INTEL_URL}/repositories/${repoId}/summary`),
  snapshots: (repoId: string) => fetchJSON<any>(`${CODE_INTEL_URL}/repositories/${repoId}/snapshots`),
  searchSymbols: (repoId: string, q: string, type?: string) => {
    const params = new URLSearchParams({ q });
    if (type) params.set("type", type);
    return fetchJSON<any>(`${CODE_INTEL_URL}/repositories/${repoId}/symbols/search?${params}`);
  },
  impact: (repoId: string, target: string) =>
    fetchJSON<any>(`${CODE_INTEL_URL}/repositories/${repoId}/impact?target=${encodeURIComponent(target)}`),
  hotspots: (repoId: string, metric?: string) => {
    const qs = metric ? `?metric=${metric}` : "";
    return fetchJSON<any>(`${CODE_INTEL_URL}/repositories/${repoId}/hotspots${qs}`);
  },
  contextBundle: (taskRunId: string) =>
    fetchJSON<any>(`${CODE_INTEL_URL}/task-runs/${taskRunId}/context-bundle`),
  structuralFindings: (reviewId: string) =>
    fetchJSON<any>(`${CODE_INTEL_URL}/reviews/${reviewId}/structural-findings`),
  triggerIndex: (repoId: string, body: Record<string, unknown> = {}) =>
    fetchJSON<any>(`${CODE_INTEL_URL}/repositories/${repoId}/index`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
