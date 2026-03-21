import { Hono } from "hono";
import { cors } from "hono/cors";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@clab/db";
import { eq } from "drizzle-orm";
import { EventBus, createEvent } from "@clab/events";

const { tasks, taskRuns, artifacts } = schema;
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
  const sessions = await db.select().from(schema.agentSessions);
  const session = sessions.find(s => {
    const meta = s.metadata as Record<string, unknown> | null;
    return meta?.taskId === taskId && (s.state === "RUNNING" || s.state === "BOUND");
  });
  return session?.id;
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
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  try {
    if (ANTHROPIC_API_KEY) {
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
    } else {
      console.log(`[worker-claude] No ANTHROPIC_API_KEY — simulating`);
      switch (task.role) {
        case "REVIEWER":
          output = `[SIMULATED Review] Reviewed: ${task.title}\n\nFindings:\n- Code follows established patterns\n- No security issues detected\n- Test coverage appears adequate\n\nVerdict: APPROVED`;
          break;
        case "PM":
          output = `[SIMULATED PM Analysis] ${task.title}\n\nDecomposition:\n- Subtask 1: Setup and configuration\n- Subtask 2: Core implementation\n- Subtask 3: Testing and validation\n\nPriority: High\nEstimated effort: Medium`;
          break;
        case "RESEARCH_ANALYST":
          output = `[SIMULATED Research] ${task.title}\n\nFindings:\n- Analyzed relevant documentation\n- Compared approaches\n- Recommendation: Use established pattern\n\nEvidence: Based on project conventions`;
          break;
        default:
          output = `[SIMULATED Claude] Completed: ${task.title}\n\nAnalysis: ${task.description}`;
      }
    }
  } catch (err) {
    output = `[Claude API Error]: ${String(err)}`;
    console.error(`[worker-claude] Claude API call failed:`, err);
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
