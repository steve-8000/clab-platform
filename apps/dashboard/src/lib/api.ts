import { CODE_INTEL_URL, CONTROL_PLANE_URL, KNOWLEDGE_URL } from "./config";

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
  health: () => fetchJSON<any>(`${CONTROL_PLANE_URL}/health`),
  threads: (status?: string) => {
    const qs = status ? `?status=${status}` : "";
    return fetchJSON<any[]>(`${CONTROL_PLANE_URL}/threads${qs}`);
  },
  thread: (id: string) => fetchJSON<any>(`${CONTROL_PLANE_URL}/threads/${id}`),
  runs: (threadId: string) =>
    fetchJSON<any>(`${CONTROL_PLANE_URL}/threads/${threadId}/runs`, { method: "POST", body: "{}" }),
  run: (id: string) => fetchJSON<any>(`${CONTROL_PLANE_URL}/runs/${id}`),
  interrupts: (threadId?: string) => {
    const qs = threadId ? `?thread_id=${threadId}` : "";
    return fetchJSON<any[]>(`${CONTROL_PLANE_URL}/interrupts${qs}`);
  },
  resolveInterrupt: (id: string, resumeValue: string) =>
    fetchJSON<any>(`${CONTROL_PLANE_URL}/interrupts/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resume_value: resumeValue }),
    }),
  workers: () => fetchJSON<any[]>(`${CONTROL_PLANE_URL}/workers`),
  artifacts: (threadId?: string) => {
    const qs = threadId ? `?thread_id=${threadId}` : "";
    return fetchJSON<any[]>(`${CONTROL_PLANE_URL}/artifacts${qs}`);
  },
  eventsUrl: (threadId: string) => `${CONTROL_PLANE_URL}/threads/${threadId}/events`,
};

// ---- Knowledge Service ----
export const ks = {
  health: () => fetchJSON<any>(`${KNOWLEDGE_URL}/health`),
  search: (q: string, limit = 10) =>
    fetchJSON<any>(`${KNOWLEDGE_URL}/v1/knowledge/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  status: () => fetchJSON<any>(`${KNOWLEDGE_URL}/v1/knowledge/status`),
  tags: () => fetchJSON<any>(`${KNOWLEDGE_URL}/v1/knowledge/tags`),
};

// ---- Code Intelligence ----
export const ci = {
  repositories: () => fetchJSON<any>(`${CODE_INTEL_URL}/repositories`),
  repository: (repoId: string) => fetchJSON<any>(`${CODE_INTEL_URL}/repositories/${repoId}`),
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
