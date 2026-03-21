import { Hono } from "hono";
import { cors } from "hono/cors";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@clab/db";
import { eq } from "drizzle-orm";
import { createLogger } from "@clab/telemetry";
import { EventBus, createEvent } from "@clab/events";

const logger = createLogger("worker-codex");

const { tasks, taskRuns, artifacts } = schema;
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://clab:clab-stg-pass@postgres:5432/clab";
const sql = postgres(DATABASE_URL);
const db = drizzle(sql, { schema });

// EventBus singleton
const eventBus = new EventBus();
let eventBusReady = false;

export async function initEventBus(): Promise<void> {
  try {
    const NATS_URL = process.env.NATS_URL || "nats://nats:4222";
    await eventBus.connect(NATS_URL);
    eventBusReady = true;
    logger.info("EventBus connected");
  } catch (err) {
    logger.warn("EventBus connection failed, events will not be published", { error: String(err) });
  }
}

export async function closeEventBus(): Promise<void> {
  if (eventBusReady) {
    await eventBus.close();
    eventBusReady = false;
  }
}

async function publishEvent(type: string, payload: Record<string, unknown>, context: { taskId?: string; taskRunId?: string; missionId?: string }): Promise<void> {
  if (!eventBusReady) {
    logger.warn("EventBus not ready, skipping event publish", { eventType: type, taskId: context.taskId });
    return;
  }
  try {
    await eventBus.publish(createEvent(type, payload, context));
  } catch (err) {
    logger.error("Failed to publish event", { eventType: type, error: String(err) });
  }
}

export async function executeTask(taskId: string): Promise<"SUCCEEDED" | "FAILED"> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) { logger.error(`Task ${taskId} not found`); return "FAILED"; }

  // Create task run
  const [run] = await db.insert(taskRuns).values({
    taskId: task.id,
    attempt: 1,
    status: "RUNNING",
  }).returning();

  // Update task to RUNNING
  await db.update(tasks).set({ status: "RUNNING", updatedAt: new Date() }).where(eq(tasks.id, taskId));

  logger.info(`Executing: ${task.title}`, { taskId });

  await publishEvent("task.run.started", { engine: task.engine, role: task.role }, { taskId, taskRunId: run.id, missionId: task.missionId });

  // Execute via Claude API or simulate
  let output: string;
  let success = true;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (ANTHROPIC_API_KEY) {
    // Real Claude API call
    logger.info(`Calling Claude API for: ${task.title}`, { taskId });
    try {
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
          system: `You are a Builder agent. Your job is to implement code changes as specified. Output the code changes clearly. Be concise and focused.`,
          messages: [{ role: "user", content: task.description }],
        }),
      });

      if (res.ok) {
        const data = await res.json() as { content: Array<{ text: string }> };
        output = data.content.map((c) => c.text).join("\n");
      } else {
        const errText = await res.text();
        output = `[Claude API Error ${res.status}]: ${errText}`;
        success = false;
        logger.error(`Claude API error: ${res.status}`, { taskId });
      }
    } catch (err) {
      output = `[Claude API Error]: ${String(err)}`;
      success = false;
      logger.error(`Claude API call failed`, { taskId, error: String(err) });
    }
  } else {
    // Simulation fallback
    output = `[SIMULATED] Task "${task.title}" executed by worker-codex.\nDescription: ${task.description}\nRole: ${task.role}`;
    logger.info(`No ANTHROPIC_API_KEY — simulating`, { taskId });
  }

  const finalStatus = success ? "SUCCEEDED" : "FAILED";

  // Update run status
  await db.update(taskRuns).set({
    status: finalStatus,
    stdout: output,
    durationMs: 1500,
    finishedAt: new Date(),
  }).where(eq(taskRuns.id, run.id));

  // Create artifact
  await db.insert(artifacts).values({
    taskRunId: run.id,
    missionId: task.missionId,
    type: "SUMMARY",
    content: output,
    metadata: { role: task.role, engine: task.engine },
  });

  // Update task status
  await db.update(tasks).set({
    status: finalStatus,
    ...(success ? { completedAt: new Date() } : {}),
    updatedAt: new Date(),
  }).where(eq(tasks.id, taskId));

  // Publish completion/failure event
  const eventType = success ? "task.run.completed" : "task.run.failed";
  await publishEvent(eventType, { status: finalStatus, engine: task.engine, role: task.role, output }, { taskId, taskRunId: run.id, missionId: task.missionId });

  // Post-K: extract insights and store knowledge (only on success)
  if (success) {
    try {
      const KNOWLEDGE_URL = process.env.KNOWLEDGE_SERVICE_URL || "http://knowledge-service:4007";
      await fetch(`${KNOWLEDGE_URL}/v1/insights/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskRunId: run.id,
          result: { status: "SUCCEEDED", summary: `Completed: ${task.title}`, output },
          context: task.description,
        }),
      });
      await fetch(`${KNOWLEDGE_URL}/v1/knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: task.title,
          content: `Task completed: ${task.title}\n\nDescription: ${task.description}\n\nOutput: ${output}`,
          tags: [task.role, task.engine, "auto-extracted"],
          source: "EXTRACTED",
        }),
      });
      logger.info(`Post-K: knowledge stored for ${taskId}`);
    } catch (err) {
      logger.warn(`Post-K failed (non-fatal)`, { taskId, error: String(err) });
    }
  }

  logger.info(`Task ${taskId} ${finalStatus}`, { taskId, status: finalStatus });
  return finalStatus;
}

export const app = new Hono()
  .use("*", cors())
  .get("/health", (c) => c.json({ status: "ok", service: "worker-codex" }))

  // POST /execute — Execute a task
  .post("/execute", async (c) => {
    const body = await c.req.json();
    const { taskId } = body;

    if (!taskId) return c.json({ error: "taskId required" }, 400);

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    if (!task) return c.json({ error: "Task not found" }, 404);

    const status = await executeTask(taskId);

    return c.json({ status, taskId });
  });
