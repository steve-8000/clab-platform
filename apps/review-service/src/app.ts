import { Hono } from "hono";
import { cors } from "hono/cors";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@clab/db";
import { eq } from "drizzle-orm";

const { tasks, taskRuns, waves, missions, artifacts } = schema;
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://clab:clab-stg-pass@postgres:5432/clab";
const sql = postgres(DATABASE_URL);
const db = drizzle(sql, { schema });

export const app = new Hono()
  .use("*", cors())
  .get("/health", (c) => c.json({ status: "ok", service: "review-service" }))

  // POST /review — Review a completed task and cascade completion
  .post("/review", async (c) => {
    const body = await c.req.json();
    const { taskId } = body;

    if (!taskId) return c.json({ error: "taskId required" }, 400);

    // 1. Get task
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    if (!task) return c.json({ error: "Task not found" }, 404);

    // 2. Get task runs
    const runs = await db.select().from(taskRuns).where(eq(taskRuns.taskId, taskId));
    const latestRun = runs[runs.length - 1];

    // 3. Get artifacts
    const taskArtifacts = latestRun
      ? await db.select().from(artifacts).where(eq(artifacts.taskRunId, latestRun.id))
      : [];

    // 4. Basic review checks
    const issues: string[] = [];
    if (!latestRun) issues.push("No task run found");
    else if (latestRun.status !== "SUCCEEDED") issues.push(`Task run status: ${latestRun.status}`);
    if (taskArtifacts.length === 0) issues.push("No artifacts produced");

    const passed = issues.length === 0;

    console.log(`[review] Task ${taskId}: ${passed ? "PASSED" : "FAILED"} (${issues.join(", ") || "ok"})`);

    // 5. If passed, check if wave is complete
    if (passed) {
      // Check all tasks in this wave
      const waveTasks = await db.select().from(tasks).where(eq(tasks.waveId, task.waveId));
      const allDone = waveTasks.every(t => t.status === "SUCCEEDED" || t.id === taskId);

      if (allDone) {
        // Mark wave complete
        await db.update(waves).set({ status: "COMPLETED", completedAt: new Date() }).where(eq(waves.id, task.waveId));
        console.log(`[review] Wave ${task.waveId} completed`);

        // Check if all waves for mission are complete
        const missionWaves = await db.select().from(waves).where(eq(waves.missionId, task.missionId));
        const allWavesDone = missionWaves.every(w => w.status === "COMPLETED" || w.id === task.waveId);

        if (allWavesDone) {
          // Mark mission complete
          await db.update(missions).set({
            status: "COMPLETED",
            completedAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(missions.id, task.missionId));
          console.log(`[review] Mission ${task.missionId} completed!`);
        }
      }
    }

    return c.json({
      taskId,
      passed,
      issues,
      artifactCount: taskArtifacts.length,
      missionId: task.missionId,
    });
  })

  // GET /status/:missionId — Get review status for a mission
  .get("/status/:missionId", async (c) => {
    const missionId = c.req.param("missionId");
    const [mission] = await db.select().from(missions).where(eq(missions.id, missionId));
    if (!mission) return c.json({ error: "Mission not found" }, 404);

    const missionTasks = await db.select().from(tasks).where(eq(tasks.missionId, missionId));
    const missionWaves = await db.select().from(waves).where(eq(waves.missionId, missionId));

    return c.json({
      missionStatus: mission.status,
      waves: missionWaves.map(w => ({ id: w.id, status: w.status })),
      tasks: missionTasks.map(t => ({ id: t.id, status: t.status, title: t.title })),
    });
  });
