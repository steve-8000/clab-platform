import * as tools from "./tools.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "mission_create",
    description: "Create a new mission from user request",
    inputSchema: tools.MissionCreateInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "mission_plan",
    description: "Generate an execution plan for a mission",
    inputSchema: tools.MissionPlanInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "mission_status",
    description: "Get the current status and progress of a mission",
    inputSchema: tools.MissionStatusInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "mission_abort",
    description: "Abort a running mission and cancel all pending tasks",
    inputSchema: tools.MissionAbortInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "task_dispatch",
    description: "Dispatch a new task to an agent",
    inputSchema: tools.TaskDispatchInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "task_list",
    description: "List tasks, optionally filtered by mission, status, or role",
    inputSchema: tools.TaskListInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "task_retry",
    description: "Retry a failed task",
    inputSchema: tools.TaskRetryInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "task_review",
    description: "Submit a review verdict for a completed task",
    inputSchema: tools.TaskReviewInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "wave_list",
    description: "List all waves for a mission",
    inputSchema: tools.WaveListInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "wave_release_next",
    description: "Release the next pending wave for execution",
    inputSchema: tools.WaveReleaseNextInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "wave_pause",
    description: "Pause a running wave",
    inputSchema: tools.WavePauseInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "session_list",
    description: "List active agent sessions",
    inputSchema: tools.SessionListInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "session_rebind",
    description: "Rebind an agent session to a new task",
    inputSchema: tools.SessionRebindInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "session_interrupt",
    description: "Interrupt an active agent session",
    inputSchema: tools.SessionInterruptInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "artifact_list",
    description: "List artifacts, optionally filtered by mission, task, or type",
    inputSchema: tools.ArtifactListInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "artifact_read",
    description: "Read the content or metadata of an artifact",
    inputSchema: tools.ArtifactReadInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "decision_record",
    description: "Record an architectural or design decision",
    inputSchema: tools.DecisionRecordInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "decision_list",
    description: "List recorded decisions for a mission",
    inputSchema: tools.DecisionListInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "knowledge_search",
    description: "Search the knowledge base by query and optional tags",
    inputSchema: tools.KnowledgeSearchInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "knowledge_store",
    description: "Store a new knowledge entry",
    inputSchema: tools.KnowledgeStoreInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "approval_list",
    description: "List pending and resolved approval gates",
    inputSchema: tools.ApprovalListInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "approval_resolve",
    description: "Approve or reject a pending approval gate",
    inputSchema: tools.ApprovalResolveInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "dashboard_snapshot",
    description: "Get a snapshot of the workspace dashboard metrics",
    inputSchema: tools.DashboardSnapshotInput.shape as unknown as Record<string, unknown>,
  },
  {
    name: "health_summary",
    description: "Get a health summary of all platform services",
    inputSchema: tools.HealthSummaryInput.shape as unknown as Record<string, unknown>,
  },
];

export function getToolDefinition(name: string): McpToolDefinition | undefined {
  return MCP_TOOLS.find((t) => t.name === name);
}
