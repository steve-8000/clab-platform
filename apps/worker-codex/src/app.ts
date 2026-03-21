import { Hono } from "hono";
import { cors } from "hono/cors";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@clab/db";
import { eq } from "drizzle-orm";

const { tasks, taskRuns, artifacts } = schema;
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://clab:clab-stg-pass@postgres:5432/clab";
const sql = postgres(DATABASE_URL);
const db = drizzle(sql, { schema });

export async function executeTask(taskId: string): Promise<void> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) { console.error(`Task ${taskId} not found`); return; }

  // Create task run
  const [run] = await db.insert(taskRuns).values({
    taskId: task.id,
    attempt: 1,
    status: "RUNNING",
  }).returning();

  // Update task to RUNNING
  await db.update(tasks).set({ status: "RUNNING", updatedAt: new Date() }).where(eq(tasks.id, taskId));

  console.log(`[worker-codex] Executing: ${task.title}`);

  // Simulate execution (will be replaced with real Claude/Codex API later)
  const output = `Task "${task.title}" executed by worker-codex.\nDescription: ${task.description}\nRole: ${task.role}`;

  // Update run to SUCCEEDED
  await db.update(taskRuns).set({
    status: "SUCCEEDED",
    stdout: output,
    durationMs: 1500,
    finishedAt: new Date(),
  }).where(eq(taskRuns.id, run.id));

  // Create artifact
  await db.insert(artifacts).values({
    taskRunId: run.id,
    missionId: task.missionId,
    type: "SUMMARY",
    content: `Completed: ${task.title}`,
    metadata: { role: task.role, engine: task.engine },
  });

  // Update task to SUCCEEDED
  await db.update(tasks).set({ status: "SUCCEEDED", completedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, taskId));

  console.log(`[worker-codex] Task ${taskId} completed`);
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

    await executeTask(taskId);

    return c.json({ status: "SUCCEEDED", taskId });
  });
