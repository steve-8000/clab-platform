import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getToolDefinition } from "@clab/mcp-contracts";
import { z } from "zod";

const DEFAULT_API_URL = "http://127.0.0.1:30400";
const apiUrl = (process.env.CLAB_API_URL || process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/$/, "");

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface MissionSummary {
  id: string;
  workspaceId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface MissionDetails {
  mission: MissionSummary;
  plans: Array<{ id: string }>;
  waves: Array<{ id: string; ordinal: number; status: string }>;
  tasks: Array<{
    id: string;
    missionId: string;
    waveId: string;
    title: string;
    role: string;
    status: string;
    createdAt?: string;
    updatedAt?: string;
  }>;
}

interface SessionRecord {
  id: string;
  workspaceId: string;
  role: string;
  engine: string;
  state: string;
}

interface ApprovalRecord {
  id: string;
  missionId: string;
  taskId?: string | null;
  requestedCapability: string;
  reason: string;
  status: string;
  createdAt: string;
}

interface MissionCreateArgs {
  workspaceId: string;
  title: string;
  request: string;
  priority?: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
}

interface MissionIdArgs {
  missionId: string;
}

interface MissionAbortArgs {
  missionId: string;
  reason?: string;
}

interface TaskListArgs {
  missionId?: string;
  status?: string;
  role?: string;
}

interface SessionListArgs {
  workspaceId?: string;
  state?: string;
}

interface KnowledgeSearchArgs {
  query: string;
  limit?: number;
  tags?: string[];
}

interface KnowledgeStoreArgs {
  topic: string;
  content: string;
  tags?: string[];
  source?: "MANUAL" | "EXTRACTED" | "DISTILLED";
  missionId?: string;
}

interface ApprovalListArgs {
  missionId?: string;
  status?: string;
}

interface ApprovalResolveArgs {
  approvalId: string;
  decision: "APPROVED" | "REJECTED";
  reason?: string;
}

interface DashboardSnapshotArgs {
  workspaceId: string;
}

function definitionDescription(name: string, fallback: string): string {
  return getToolDefinition(name)?.description || fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init?.method || "GET"} ${path} failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<T>;
}

function textResult(label: string, payload: JsonValue): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text" as const,
        text: `${label}\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  };
}

function countTaskStates(tasks: MissionDetails["tasks"]): {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  runningTasks: number;
} {
  const progress = {
    totalTasks: tasks.length,
    completedTasks: 0,
    failedTasks: 0,
    runningTasks: 0,
  };

  for (const task of tasks) {
    if (task.status === "SUCCEEDED") progress.completedTasks += 1;
    else if (task.status === "FAILED") progress.failedTasks += 1;
    else if (["ASSIGNED", "RUNNING"].includes(task.status)) progress.runningTasks += 1;
  }

  return progress;
}

async function listAllMissions(): Promise<MissionSummary[]> {
  return request<MissionSummary[]>("/v1/missions");
}

async function getMission(missionId: string): Promise<MissionDetails> {
  return request<MissionDetails>(`/v1/missions/${missionId}`);
}

async function listAllTasks(): Promise<MissionDetails["tasks"]> {
  const missions = await listAllMissions();
  const details = await Promise.all(missions.map(mission => getMission(mission.id)));
  return details.flatMap(detail => detail.tasks);
}

async function listApprovals(): Promise<ApprovalRecord[]> {
  return request<ApprovalRecord[]>("/v1/approvals");
}

async function listSessions(): Promise<SessionRecord[]> {
  return request<SessionRecord[]>("/v1/sessions");
}

const server = new McpServer({
  name: "clab-platform",
  version: "2.0.0",
});

server.registerTool("mission_create", {
  description: definitionDescription("mission_create", "Create a mission in clab-platform."),
  inputSchema: {
    workspaceId: z.string(),
    title: z.string(),
    request: z.string(),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(),
  },
}, async ({ workspaceId, title, request: missionRequest, priority }: MissionCreateArgs) => {
  const response = await request<MissionDetails>("/v1/missions", {
    method: "POST",
    body: JSON.stringify({
      workspaceId,
      title,
      objective: missionRequest,
      priority: priority || "NORMAL",
    }),
  });

  return textResult("Mission created.", {
    missionId: response.mission.id,
    status: response.mission.status,
    waveCount: response.waves.length,
    taskCount: response.tasks.length,
  });
});

server.registerTool("mission_plan", {
  description: definitionDescription("mission_plan", "Read the generated plan for a mission."),
  inputSchema: {
    missionId: z.string(),
  },
}, async ({ missionId }: MissionIdArgs) => {
  const response = await getMission(missionId);
  return textResult("Mission plan.", {
    planId: response.plans[0]?.id || null,
    waveCount: response.waves.length,
    taskCount: response.tasks.length,
  });
});

server.registerTool("mission_status", {
  description: definitionDescription("mission_status", "Get mission status and progress."),
  inputSchema: {
    missionId: z.string(),
  },
}, async ({ missionId }: MissionIdArgs) => {
  const response = await getMission(missionId);
  return textResult("Mission status.", {
    missionId: response.mission.id,
    status: response.mission.status,
    title: response.mission.title,
    progress: countTaskStates(response.tasks),
    createdAt: response.mission.createdAt,
    updatedAt: response.mission.updatedAt,
  });
});

server.registerTool("mission_abort", {
  description: definitionDescription("mission_abort", "Abort a running mission."),
  inputSchema: {
    missionId: z.string(),
    reason: z.string().optional(),
  },
}, async ({ missionId, reason }: MissionAbortArgs) => {
  const response = await request<{ status: string; cancelledTasks: number; failedWaves: number }>(`/v1/missions/${missionId}/abort`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });

  return textResult("Mission aborted.", {
    missionId,
    status: response.status,
    abortedTasks: response.cancelledTasks,
  });
});

server.registerTool("wave_list", {
  description: definitionDescription("wave_list", "List waves for a mission."),
  inputSchema: {
    missionId: z.string(),
  },
}, async ({ missionId }: MissionIdArgs) => {
  const response = await getMission(missionId);
  return textResult("Mission waves.", {
    waves: response.waves.map(wave => ({
      waveId: wave.id,
      index: wave.ordinal,
      status: wave.status,
      taskCount: response.tasks.filter(task => task.waveId === wave.id).length,
    })),
  });
});

server.registerTool("task_list", {
  description: definitionDescription("task_list", "List tasks with optional filters."),
  inputSchema: {
    missionId: z.string().optional(),
    status: z.string().optional(),
    role: z.string().optional(),
  },
}, async ({ missionId, status, role }: TaskListArgs) => {
  const tasks = missionId ? (await getMission(missionId)).tasks : await listAllTasks();
  const filtered = tasks.filter(task => {
    if (status && task.status !== status) return false;
    if (role && task.role !== role) return false;
    return true;
  });

  return textResult("Tasks.", {
    tasks: filtered.map(task => ({
      taskId: task.id,
      title: task.title,
      role: task.role,
      status: task.status,
      missionId: task.missionId,
    })),
  });
});

server.registerTool("session_list", {
  description: definitionDescription("session_list", "List active agent sessions."),
  inputSchema: {
    workspaceId: z.string().optional(),
    state: z.string().optional(),
  },
}, async ({ workspaceId, state }: SessionListArgs) => {
  const sessions = await listSessions();
  const filtered = sessions.filter(session => {
    if (workspaceId && session.workspaceId !== workspaceId) return false;
    if (state && session.state !== state) return false;
    return true;
  });

  return textResult("Sessions.", {
    sessions: filtered.map(session => ({
      sessionId: session.id,
      role: session.role,
      engine: session.engine,
      state: session.state,
      workspaceId: session.workspaceId,
    })),
  });
});

server.registerTool("knowledge_search", {
  description: definitionDescription("knowledge_search", "Search the knowledge base."),
  inputSchema: {
    query: z.string(),
    limit: z.number().int().positive().optional(),
    tags: z.array(z.string()).optional(),
  },
}, async ({ query, limit, tags }: KnowledgeSearchArgs) => {
  const search = tags && tags.length > 0
    ? await request<{ ok: boolean; entries: Array<Record<string, JsonValue>> }>(`/v1/knowledge/tags?tags=${encodeURIComponent(tags.join(","))}`)
    : await request<{ ok: boolean; results: Array<Record<string, JsonValue>> }>(`/v1/knowledge/search?q=${encodeURIComponent(query)}`);

  const entries = "entries" in search ? search.entries : search.results;
  return textResult("Knowledge search.", {
    entries: entries.slice(0, limit || 10),
  });
});

server.registerTool("knowledge_store", {
  description: definitionDescription("knowledge_store", "Store a knowledge entry."),
  inputSchema: {
    topic: z.string(),
    content: z.string(),
    tags: z.array(z.string()).optional(),
    source: z.enum(["MANUAL", "EXTRACTED", "DISTILLED"]).optional(),
    missionId: z.string().optional(),
  },
}, async ({ topic, content, tags, source, missionId }: KnowledgeStoreArgs) => {
  const response = await request<{ ok: boolean; entry: { id: string; topic: string } }>("/v1/knowledge", {
    method: "POST",
    body: JSON.stringify({
      topic,
      content,
      tags: tags || [],
      source: source || "MANUAL",
      missionId,
    }),
  });

  return textResult("Knowledge stored.", {
    id: response.entry.id,
    topic: response.entry.topic,
    stored: response.ok,
  });
});

server.registerTool("approval_list", {
  description: definitionDescription("approval_list", "List approvals."),
  inputSchema: {
    missionId: z.string().optional(),
    status: z.string().optional(),
  },
}, async ({ missionId, status }: ApprovalListArgs) => {
  const approvals = await listApprovals();
  const filtered = approvals.filter(approval => {
    if (missionId && approval.missionId !== missionId) return false;
    if (status && approval.status !== status) return false;
    return true;
  });

  return textResult("Approvals.", {
    approvals: filtered.map(approval => ({
      approvalId: approval.id,
      missionId: approval.missionId,
      taskId: approval.taskId ?? null,
      gateType: approval.requestedCapability,
      requestedAction: approval.reason,
      status: approval.status,
      requestedAt: approval.createdAt,
    })),
  });
});

server.registerTool("approval_resolve", {
  description: definitionDescription("approval_resolve", "Resolve an approval."),
  inputSchema: {
    approvalId: z.string(),
    decision: z.enum(["APPROVED", "REJECTED"]),
    reason: z.string().optional(),
  },
}, async ({ approvalId, decision, reason }: ApprovalResolveArgs) => {
  const response = await request<{ id: string; status: string }>(`/v1/approvals/${approvalId}/resolve`, {
    method: "POST",
    body: JSON.stringify({
      action: decision === "APPROVED" ? "GRANTED" : "DENIED",
      reason,
    }),
  });

  return textResult("Approval resolved.", {
    approvalId: response.id,
    status: response.status,
    resolvedAt: new Date().toISOString(),
  });
});

server.registerTool("dashboard_snapshot", {
  description: definitionDescription("dashboard_snapshot", "Get workspace dashboard metrics."),
  inputSchema: {
    workspaceId: z.string(),
  },
}, async ({ workspaceId }: DashboardSnapshotArgs) => {
  const [dashboard, missions, approvals] = await Promise.all([
    request<Record<string, JsonValue>>(`/v1/dashboard?workspaceId=${encodeURIComponent(workspaceId)}`),
    listAllMissions(),
    listApprovals(),
  ]);

  const relevantMissionIds = missions.filter(mission => mission.workspaceId === workspaceId).map(mission => mission.id);
  const details = await Promise.all(relevantMissionIds.map(id => getMission(id)));
  const tasks = details.flatMap(detail => detail.tasks);
  const runningTasks = tasks.filter(task => ["ASSIGNED", "RUNNING"].includes(task.status)).length;
  const completedTasks = tasks.filter(task => task.status === "SUCCEEDED").length;
  const failedTasks = tasks.filter(task => task.status === "FAILED").length;
  const activeSessions = (dashboard.activeSessions as JsonValue[] | undefined)?.length || 0;
  const pendingApprovals = approvals.filter(approval => approval.missionId && relevantMissionIds.includes(approval.missionId) && approval.status === "PENDING").length;

  return textResult("Dashboard snapshot.", {
    workspaceId,
    activeMissions: missions.filter(mission => mission.workspaceId === workspaceId && mission.status === "RUNNING").length,
    totalTasks: tasks.length,
    runningTasks,
    completedTasks,
    failedTasks,
    activeSessions,
    pendingApprovals,
    recentDecisions: 0,
  });
});

server.registerTool("health_summary", {
  description: definitionDescription("health_summary", "Get platform health summary."),
  inputSchema: {},
}, async () => {
  const response = await request<{ status: string; services: Record<string, string> }>("/v1/health/all");
  const status = response.status === "ok"
    ? "healthy"
    : response.status === "degraded"
      ? "degraded"
      : "unhealthy";

  return textResult("Health summary.", {
    status,
    services: Object.entries(response.services).map(([name, serviceStatus]) => ({
      name,
      status: serviceStatus,
    })),
    uptime: 0,
    version: "2.0.0",
  });
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`clab MCP server connected via stdio (api=${apiUrl})`);
}

main().catch((error) => {
  console.error("clab MCP server failed:", error);
  process.exit(1);
});
