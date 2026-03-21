import { Hono } from "hono";
// import { ClabClient } from "@clab/sdk";

const mcp = new Hono();

// ---------------------------------------------------------------------------
// MCP tool definitions — each maps to a backend SDK call
// ---------------------------------------------------------------------------

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOL_DEFINITIONS: McpToolDef[] = [
  {
    name: "mission_create",
    description: "Create a new mission from a goal description.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "Mission goal" },
        workspaceId: { type: "string", description: "Target workspace ID" },
      },
      required: ["goal"],
    },
  },
  {
    name: "mission_get",
    description: "Retrieve the current status of a mission.",
    inputSchema: {
      type: "object",
      properties: {
        missionId: { type: "string" },
      },
      required: ["missionId"],
    },
  },
  {
    name: "mission_plan",
    description: "Trigger planning phase for a mission.",
    inputSchema: {
      type: "object",
      properties: {
        missionId: { type: "string" },
      },
      required: ["missionId"],
    },
  },
  {
    name: "mission_abort",
    description: "Abort a running mission.",
    inputSchema: {
      type: "object",
      properties: {
        missionId: { type: "string" },
      },
      required: ["missionId"],
    },
  },
  {
    name: "task_dispatch",
    description: "Create and dispatch a task to an agent session.",
    inputSchema: {
      type: "object",
      properties: {
        missionId: { type: "string" },
        prompt: { type: "string" },
        role: { type: "string" },
      },
      required: ["missionId", "prompt"],
    },
  },
  {
    name: "task_retry",
    description: "Retry a failed task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "task_review",
    description: "Submit a review result for a completed task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        verdict: { type: "string", enum: ["approve", "reject", "revise"] },
        feedback: { type: "string" },
      },
      required: ["taskId", "verdict"],
    },
  },
  {
    name: "wave_release",
    description: "Release the next wave of tasks for a mission.",
    inputSchema: {
      type: "object",
      properties: {
        waveId: { type: "string" },
      },
      required: ["waveId"],
    },
  },
  {
    name: "session_list",
    description: "List active agent sessions.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "session_interrupt",
    description: "Send an interrupt signal to a running session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "approval_resolve",
    description: "Resolve a pending human approval request.",
    inputSchema: {
      type: "object",
      properties: {
        approvalId: { type: "string" },
        decision: { type: "string", enum: ["approve", "reject"] },
        reason: { type: "string" },
      },
      required: ["approvalId", "decision"],
    },
  },
  {
    name: "dashboard",
    description: "Retrieve the aggregated dashboard view.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// POST /mcp/tools/list — return all MCP tool definitions
// ---------------------------------------------------------------------------

mcp.post("/tools/list", async (c) => {
  return c.json({ tools: TOOL_DEFINITIONS });
});

// ---------------------------------------------------------------------------
// POST /mcp/tools/call — execute a tool by name with arguments
// ---------------------------------------------------------------------------

type ToolArgs = Record<string, unknown>;

async function dispatchTool(
  name: string,
  args: ToolArgs,
): Promise<{ content: unknown; isError?: boolean }> {
  // TODO: replace stubs with real ClabClient calls once SDK is wired
  switch (name) {
    case "mission_create":
      return { content: { ok: true, action: "mission.create", args } };
    case "mission_get":
      return { content: { ok: true, action: "mission.get", args } };
    case "mission_plan":
      return { content: { ok: true, action: "mission.plan", args } };
    case "mission_abort":
      return { content: { ok: true, action: "mission.abort", args } };
    case "task_dispatch":
      return { content: { ok: true, action: "task.dispatch", args } };
    case "task_retry":
      return { content: { ok: true, action: "task.retry", args } };
    case "task_review":
      return { content: { ok: true, action: "task.review", args } };
    case "wave_release":
      return { content: { ok: true, action: "wave.release", args } };
    case "session_list":
      return { content: { ok: true, action: "session.list", args } };
    case "session_interrupt":
      return { content: { ok: true, action: "session.interrupt", args } };
    case "approval_resolve":
      return { content: { ok: true, action: "approval.resolve", args } };
    case "dashboard":
      return { content: { ok: true, action: "dashboard", args } };
    default:
      return { content: { error: `Unknown tool: ${name}` }, isError: true };
  }
}

mcp.post("/tools/call", async (c) => {
  const { name, arguments: args } = await c.req.json<{
    name: string;
    arguments: ToolArgs;
  }>();

  if (!name) {
    return c.json({ error: "Missing tool name" }, 400);
  }

  const known = TOOL_DEFINITIONS.find((t) => t.name === name);
  if (!known) {
    return c.json({ error: `Unknown tool: ${name}` }, 404);
  }

  const result = await dispatchTool(name, args ?? {});
  return c.json(result);
});

export { mcp as mcpHandler };
