import type {
  Mission,
  Plan,
  Wave,
  Task,
  AgentSession,
} from "@clab/domain";

export class ClabClient {
  constructor(private baseUrl: string) {}

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await globalThis.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    if (!res.ok)
      throw new Error(`API error ${res.status}: ${await res.text()}`);
    return res.json() as T;
  }

  // ---- Missions ----

  async createMission(input: {
    workspaceId: string;
    title: string;
    request: string;
    priority?: string;
  }): Promise<Mission> {
    return this.fetch("/v1/missions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getMission(id: string): Promise<Mission> {
    return this.fetch(`/v1/missions/${id}`);
  }

  async planMission(id: string): Promise<Plan> {
    return this.fetch(`/v1/missions/${id}/plan`, { method: "POST" });
  }

  async abortMission(id: string): Promise<Mission> {
    return this.fetch(`/v1/missions/${id}/abort`, { method: "POST" });
  }

  // ---- Tasks ----

  async dispatchTask(input: {
    missionId: string;
    role: string;
    title: string;
    instruction: string;
    expectedOutputs?: string[];
  }): Promise<Task> {
    return this.fetch("/v1/tasks", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async listTasks(missionId?: string): Promise<Task[]> {
    const q = missionId ? `?missionId=${missionId}` : "";
    return this.fetch(`/v1/tasks${q}`);
  }

  async retryTask(id: string): Promise<Task> {
    return this.fetch(`/v1/tasks/${id}/retry`, { method: "POST" });
  }

  // ---- Waves ----

  async listWaves(missionId: string): Promise<Wave[]> {
    return this.fetch(`/v1/waves/${missionId}`);
  }

  async releaseWave(id: string): Promise<Wave> {
    return this.fetch(`/v1/waves/${id}/release`, { method: "POST" });
  }

  // ---- Sessions ----

  async listSessions(): Promise<AgentSession[]> {
    return this.fetch("/v1/sessions");
  }

  async rebindSession(id: string): Promise<AgentSession> {
    return this.fetch(`/v1/sessions/${id}/rebind`, { method: "POST" });
  }

  // ---- Dashboard ----

  async dashboardSnapshot(
    workspaceId: string,
  ): Promise<Record<string, unknown>> {
    return this.fetch(`/v1/dashboard?workspaceId=${workspaceId}`);
  }

  // ---- Health ----

  async health(): Promise<{ status: string }> {
    return this.fetch("/health");
  }
}
