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

export const app = new Hono()
  .use("*", cors())
  .get("/health", (c) => c.json({ status: "ok", service: "worker-codex" }))

  // POST /execute — Execute a task
  .post("/execute", async (c) => {
    const body = await c.req.json();
    const { taskId } = body;

    if (!taskId) return c.json({ error: "taskId required" }, 400);

    // 1. Get the task
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    if (!task) return c.json({ error: "Task not found" }, 404);

    // 2. Create task run
    const [run] = await db.insert(taskRuns).values({
      taskId: task.id,
      attempt: 1,
      status: "RUNNING",
    }).returning();

    // 3. Update task status to RUNNING
    await db.update(tasks).set({ status: "RUNNING", updatedAt: new Date() }).where(eq(tasks.id, taskId));

    console.log(`[worker-codex] Executing task ${taskId}: ${task.title}`);

    // 4. Simulate execution (in real impl, this would run codex)
    const executionResult = {
      summary: `Completed: ${task.title}`,
      output: `Task "${task.title}" executed successfully by worker-codex.\nDescription: ${task.description}\nRole: ${task.role}`,
    };

    // 5. Update task run to SUCCEEDED
    const durationMs = 1500; // simulated
    await db.update(taskRuns).set({
      status: "SUCCEEDED",
      stdout: executionResult.output,
      durationMs,
      finishedAt: new Date(),
    }).where(eq(taskRuns.id, run.id));

    // 6. Create artifact
    const [artifact] = await db.insert(artifacts).values({
      taskRunId: run.id,
      missionId: task.missionId,
      type: "SUMMARY",
      content: executionResult.summary,
      metadata: { role: task.role, engine: task.engine },
    }).returning();

    // 7. Update task to SUCCEEDED
    await db.update(tasks).set({ status: "SUCCEEDED", completedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, taskId));

    console.log(`[worker-codex] Task ${taskId} completed, artifact ${artifact.id} created`);

    return c.json({
      taskRun: { ...run, status: "SUCCEEDED", durationMs },
      artifact,
    });
  });
