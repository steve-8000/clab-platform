import { Hono } from "hono";
import { cors } from "hono/cors";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@clab/db";
import { eq } from "drizzle-orm";
import { EventBus, createEvent } from "@clab/events";
import { CmuxSocketClient } from "@clab/cmux-adapter";
import { createRunner } from "@clab/engines";
import { getPrompt, renderPrompt } from "@clab/prompts";

const { tasks, taskRuns, artifacts, agentSessions } = schema;
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://clab:clab-stg-pass@postgres:5432/clab";
const sql = postgres(DATABASE_URL);
const db = drizzle(sql, { schema });

const RUNTIME_URL = process.env.RUNTIME_MANAGER_URL || "http://runtime-manager:4002";
const NATS_URL = process.env.NATS_URL || "nats://nats:4222";

const eventBus = new EventBus();
let eventBusReady = false;

async function ensureEventBus(): Promise<void> {
  if (eventBusReady) return;
  try {
    await eventBus.connect(NATS_URL);
    eventBusReady = true;
  } catch (err) {
    console.warn("[worker-claude] EventBus unavailable:", err);
  }
}

async function reportHeartbeat(sessionId: string): Promise<void> {
  try {
    await fetch(`${RUNTIME_URL}/sessions/${sessionId}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) }),
    });
  } catch {}
}

async function findSessionForTask(taskId: string): Promise<string | undefined> {
  const sessions = await db.select().from(agentSessions);
  const session = sessions.find(s => {
    const meta = s.metadata as Record<string, unknown> | null;
    return (meta?.currentTaskId === taskId || meta?.taskId === taskId) && (s.state === "RUNNING" || s.state === "BOUND");
  });
  return session?.id;
}

function resolvePromptRole(role: string): string {
  const map: Record<string, string> = {
    REVIEWER: "OPERATIONS_REVIEWER",
    OPERATIONS_REVIEWER: "OPERATIONS_REVIEWER",
    PM: "PM",
    RESEARCH_ANALYST: "RESEARCH_ANALYST",
    STRATEGIST: "STRATEGIST",
  };
  return map[role] ?? "PM";
}

async function ensureSessionPane(sessionId: string, role: string): Promise<{ paneId: string; disconnect: () => void }> {
  const cmux = new CmuxSocketClient();
  await cmux.connect();

  const [session] = await db.select().from(agentSessions).where(eq(agentSessions.id, sessionId));
  if (!session) {
    cmux.disconnect();
    throw new Error(`Session ${sessionId} not found`);
  }

  if (session.paneId) {
    return { paneId: session.paneId, disconnect: () => cmux.disconnect() };
  }

  let paneId: string | undefined;
  const workspace = await cmux.workspaceCurrent();
  const panes = await cmux.paneList(workspace.id);
  const anchorPaneId = panes.find((pane) => pane.active)?.id ?? panes[0]?.id;
  paneId = (await cmux.paneSplit("right", anchorPaneId)).id;

  await db.update(agentSessions).set({
    paneId,
    metadata: {
      ...(session.metadata as Record<string, unknown> || {}),
      cmuxProvisionedAt: new Date().toISOString(),
    },
  }).where(eq(agentSessions.id, sessionId));

  return { paneId, disconnect: () => cmux.disconnect() };
}

async function runTaskInCmux(task: typeof tasks.$inferSelect, sessionId: string): Promise<string> {
  const { paneId, disconnect } = await ensureSessionPane(sessionId, task.role);

  try {
    const cmux = new CmuxSocketClient();
    await cmux.connect();
    const runner = createRunner("CLAUDE", cmux);
    const prompt = getPrompt(resolvePromptRole(task.role));
    const rendered = prompt
      ? renderPrompt(prompt, {
        instruction: task.description,
        workingDir: process.env.WORKDIR_ROOT || process.cwd(),
        context: "",
        progress: "",
        resources: "",
        acceptanceCriteria: "",
        standards: "",
        scope: "",
        knownInfo: "",
        businessContext: "",
        techLandscape: "",
      })
      : {
        system: "You are working inside an interactive Claude TUI session.",
        user: task.description,
      };

    await runner.start({
      sessionId,
      paneId,
      workingDir: process.env.WORKDIR_ROOT || process.cwd(),
      instruction: rendered.user,
      systemPrompt: rendered.system,
    });

    const startedAt = Date.now();
    const knownNotificationIds = new Set((await cmux.notificationList()).map((n) => n.id));
    let stableIdleReads = 0;
    let lastOutput = "";

    while (Date.now() - startedAt < (task.timeoutMs ?? 300_000)) {
      const output = await runner.readOutput(paneId);
      const notifications = (await cmux.notificationList()) as Array<{
        id: string;
        title?: string;
        subtitle?: string;
        body?: string;
        paneId?: string;
      }>;
      const paneNotification = notifications.find((notification) => {
        if (knownNotificationIds.has(notification.id))
          return false;

        const text = `${notification.title ?? ""}\n${notification.subtitle ?? ""}\n${notification.body ?? ""}`.toLowerCase();
        return notification.paneId === paneId || text.includes(paneId.toLowerCase());
      });
      if (paneNotification && runner.isIdle(output)) {
        return output;
      }

      if (output === lastOutput && runner.isIdle(output)) {
        stableIdleReads += 1;
        if (stableIdleReads >= 3) {
          return output;
        }
      } else {
        stableIdleReads = 0;
        lastOutput = output;
      }
      for (const notification of notifications) {
        knownNotificationIds.add(notification.id);
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    return await runner.readOutput(paneId);
  } finally {
    disconnect();
  }
}

export async function executeTask(taskId: string): Promise<void> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) { console.error(`Task ${taskId} not found`); return; }

  await ensureEventBus();
  const sessionId = await findSessionForTask(taskId);

  const [run] = await db.insert(taskRuns).values({
    taskId: task.id,
    sessionId: sessionId ?? null,
    attempt: 1,
    status: "RUNNING",
  }).returning();

  await db.update(tasks).set({ status: "RUNNING", updatedAt: new Date() }).where(eq(tasks.id, taskId));

  console.log(`[worker-claude] Executing (${task.role}): ${task.title} (session: ${sessionId ?? "none"})`);

  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  if (sessionId) {
    heartbeatInterval = setInterval(() => reportHeartbeat(sessionId), 15_000);
    await reportHeartbeat(sessionId);
  }

  let output: string;
  const startTime = Date.now();
  const executionMode = process.env.EXECUTION_MODE || "k8s";

  try {
    if (executionMode === "local") {
      if (!sessionId) throw new Error(`No bound session found for task ${taskId}`);
      output = await runTaskInCmux(task, sessionId);
      console.log(`[worker-claude] Executed in cmux TUI for (${task.role}): ${task.title}`);
    } else {
      const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
      if (!ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is required when EXECUTION_MODE is not local");
      }

      const systemPrompts: Record<string, string> = {
        REVIEWER: "You are a code reviewer. Analyze the given code or description for bugs, security issues, and quality. Provide a clear verdict: APPROVED or NEEDS_CHANGES with specific issues.",
        PM: "You are a project manager. Decompose the given objective into clear subtasks with priorities and dependencies. Be structured and concise.",
        RESEARCH_ANALYST: "You are a research analyst. Research the given topic, provide evidence-based findings, and give actionable recommendations.",
      };
      const systemPrompt = systemPrompts[task.role] || "You are an AI assistant. Complete the given task thoroughly.";

      console.log(`[worker-claude] Calling Claude API for (${task.role}): ${task.title}`);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: task.description }],
        }),
      });

      if (res.ok) {
        const data = await res.json() as { content: Array<{ text: string }> };
        output = data.content.map((c) => c.text).join("\n");
      } else {
        output = `[Claude API Error ${res.status}]: ${await res.text()}`;
        console.error(`[worker-claude] Claude API error: ${res.status}`);
      }
    }
  } catch (err) {
    output = `[worker-claude error]: ${String(err)}`;
    console.error(`[worker-claude] Task execution failed:`, err);
  } finally {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
  }

  const durationMs = Date.now() - startTime;

  await db.update(taskRuns).set({
    status: "SUCCEEDED",
    stdout: output,
    durationMs,
    finishedAt: new Date(),
  }).where(eq(taskRuns.id, run.id));

  await db.insert(artifacts).values({
    taskRunId: run.id,
    missionId: task.missionId,
    type: "SUMMARY",
    content: output,
    metadata: { role: task.role, engine: "CLAUDE" },
  });

  await db.update(tasks).set({ status: "SUCCEEDED", completedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, taskId));

  if (eventBusReady) {
    await eventBus.publish(createEvent("task.run.completed", {
      taskId,
      taskRunId: run.id,
      status: "SUCCEEDED",
      durationMs,
    }, {
      taskId,
      missionId: task.missionId,
      sessionId,
      actor: { kind: "system", id: "worker-claude" },
    }));
  }

  console.log(`[worker-claude] Task ${taskId} completed (${durationMs}ms)`);
}

export const app = new Hono()
  .use("*", cors())
  .get("/health", (c) => c.json({ status: "ok", service: "worker-claude" }))
  .post("/execute", async (c) => {
    const body = await c.req.json();
    if (!body.taskId) return c.json({ error: "taskId required" }, 400);
    await executeTask(body.taskId);
    return c.json({ status: "SUCCEEDED", taskId: body.taskId });
  });
