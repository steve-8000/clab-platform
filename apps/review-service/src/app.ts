import { Hono } from "hono";
import { cors } from "hono/cors";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@clab/db";
import { eq } from "drizzle-orm";
import {
  TASK_TRANSITIONS,
  WAVE_TRANSITIONS,
  MISSION_TRANSITIONS,
  assertTransition,
  canTransition,
} from "@clab/domain";

const { tasks, taskRuns, waves, missions, artifacts, approvals } = schema;
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://clab:clab-stg-pass@postgres:5432/clab";
const sql = postgres(DATABASE_URL);
const db = drizzle(sql, { schema });

// Risk scoring
function computeRisk(task: Record<string, unknown>, artifactCount: number): { score: number; level: string; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const desc = String(task.description || "").toLowerCase();

  if (/\b(deploy|migration|infra|production)\b/.test(desc)) { score += 30; reasons.push("deployment/infra changes"); }
  if (/\b(delete|remove|drop|destroy)\b/.test(desc)) { score += 25; reasons.push("destructive operations"); }
  if (/\b(secret|password|token|credential|env)\b/.test(desc)) { score += 20; reasons.push("sensitive data access"); }
  if (/\b(external|api|http|webhook)\b/.test(desc)) { score += 15; reasons.push("external system interaction"); }
  if (artifactCount > 5) { score += 10; reasons.push("high artifact count"); }

  const level = score >= 70 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";
  return { score: Math.min(score, 100), level, reasons };
}

// Standalone review logic — usable from both HTTP and NATS
export async function reviewTask(taskId: string): Promise<{ passed: boolean; issues: string[]; artifactCount: number; missionId: string; risk?: { score: number; level: string; reasons: string[] }; approvalRequired?: boolean; approvalId?: string }> {
  // 1. Get task
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new Error("Task not found");

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

  // 4b. Risk scoring
  const risk = computeRisk(task, taskArtifacts.length);
  if (risk.level === "HIGH") issues.push(`High risk (${risk.score}): ${risk.reasons.join(", ")}`);

  const passed = issues.length === 0;
  let approvalRequired = false;
  let approvalId: string | undefined;

  // 4c. If medium+ risk and passed, create approval request
  if (passed && risk.level !== "LOW") {
    approvalRequired = true;
    const [approval] = await db.insert(approvals).values({
      missionId: task.missionId,
      taskId: task.id,
      requestedCapability: risk.reasons[0] || "unknown",
      reason: `Risk score ${risk.score} (${risk.level}): ${risk.reasons.join(", ")}`,
      status: risk.level === "HIGH" ? "PENDING" : "GRANTED", // Auto-approve MEDIUM, manual for HIGH
      riskLevel: risk.level,
      actorKind: "system",
      actorId: "review-service",
    }).returning();
    approvalId = approval.id;
    console.log(`[review] Approval ${approval.id}: ${risk.level} risk — ${risk.level === "HIGH" ? "PENDING manual approval" : "auto-approved"}`);
  }

  console.log(`[review] Task ${taskId}: ${passed ? "PASSED" : "FAILED"} (risk: ${risk.level}/${risk.score})`);

  // 5. If passed, update task status and check wave completion
  if (passed) {
    // Task → SUCCEEDED
    if (canTransition(TASK_TRANSITIONS, task.status as "RUNNING", "SUCCEEDED")) {
      assertTransition(TASK_TRANSITIONS, task.status as "RUNNING", "SUCCEEDED");
      await db.update(tasks).set({ status: "SUCCEEDED", completedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, taskId));
    }

    const waveTasks = await db.select().from(tasks).where(eq(tasks.waveId, task.waveId));
    const allDone = waveTasks.every(t => t.status === "SUCCEEDED" || t.id === taskId);

    if (allDone) {
      // Wave → COMPLETED
      const [wave] = await db.select().from(waves).where(eq(waves.id, task.waveId));
      if (wave && canTransition(WAVE_TRANSITIONS, wave.status as "RUNNING", "COMPLETED")) {
        assertTransition(WAVE_TRANSITIONS, wave.status as "RUNNING", "COMPLETED");
        await db.update(waves).set({ status: "COMPLETED", completedAt: new Date() }).where(eq(waves.id, task.waveId));
        console.log(`[review] Wave ${task.waveId} RUNNING→COMPLETED`);
      }

      // Check for next wave or mission completion
      const missionWaves = await db.select().from(waves).where(eq(waves.missionId, task.missionId));
      const sortedWaves = missionWaves.sort((a, b) => a.ordinal - b.ordinal);
      const completedWaveIndex = sortedWaves.findIndex(w => w.id === task.waveId);
      const nextWave = sortedWaves[completedWaveIndex + 1];

      if (nextWave && nextWave.status === "PENDING") {
        // Start next wave cascade: PENDING → READY → RUNNING
        assertTransition(WAVE_TRANSITIONS, "PENDING", "READY");
        await db.update(waves).set({ status: "READY" }).where(eq(waves.id, nextWave.id));

        assertTransition(WAVE_TRANSITIONS, "READY", "RUNNING");
        await db.update(waves).set({ status: "RUNNING", startedAt: new Date() }).where(eq(waves.id, nextWave.id));

        // Assign tasks in the next wave
        const nextWaveTasks = await db.select().from(tasks).where(eq(tasks.waveId, nextWave.id));
        for (const nTask of nextWaveTasks) {
          if (canTransition(TASK_TRANSITIONS, nTask.status as "QUEUED", "ASSIGNED")) {
            assertTransition(TASK_TRANSITIONS, nTask.status as "QUEUED", "ASSIGNED");
            await db.update(tasks).set({ status: "ASSIGNED", updatedAt: new Date() }).where(eq(tasks.id, nTask.id));
          }
        }

        console.log(`[review] Wave cascade: wave ${nextWave.ordinal} started (${nextWaveTasks.length} tasks)`);
      } else {
        // All waves done — check mission completion
        const allWavesDone = sortedWaves.every(w => w.status === "COMPLETED" || w.id === task.waveId);

        if (allWavesDone) {
          // Mission RUNNING → REVIEWING → COMPLETED
          const [mission] = await db.select().from(missions).where(eq(missions.id, task.missionId));
          if (mission && canTransition(MISSION_TRANSITIONS, mission.status as "RUNNING", "REVIEWING")) {
            assertTransition(MISSION_TRANSITIONS, mission.status as "RUNNING", "REVIEWING");
            await db.update(missions).set({ status: "REVIEWING", updatedAt: new Date() }).where(eq(missions.id, task.missionId));

            assertTransition(MISSION_TRANSITIONS, "REVIEWING", "COMPLETED");
            await db.update(missions).set({
              status: "COMPLETED",
              completedAt: new Date(),
              updatedAt: new Date(),
            }).where(eq(missions.id, task.missionId));
            console.log(`[review] Mission ${task.missionId} RUNNING→REVIEWING→COMPLETED`);
          }
        }
      }
    }
  }

  return { passed, issues, artifactCount: taskArtifacts.length, missionId: task.missionId, risk, approvalRequired, approvalId };
}

export const app = new Hono()
  .use("*", cors())
  .get("/health", (c) => c.json({ status: "ok", service: "review-service" }))

  // POST /review — Review a completed task and cascade completion
  .post("/review", async (c) => {
    const body = await c.req.json();
    const { taskId } = body;

    if (!taskId) return c.json({ error: "taskId required" }, 400);

    try {
      const result = await reviewTask(taskId);
      return c.json({ taskId, ...result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "Task not found") return c.json({ error: "Task not found" }, 404);
      throw err;
    }
  })

  // GET /approvals — list all approvals
  .get("/approvals", async (c) => {
    const all = await db.select().from(approvals);
    return c.json(all);
  })

  // POST /approvals/:id/resolve — approve or deny
  .post("/approvals/:id/resolve", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const action = body.action as string; // "GRANTED" or "DENIED"

    if (!["GRANTED", "DENIED"].includes(action)) {
      return c.json({ error: "action must be GRANTED or DENIED" }, 400);
    }

    await db.update(approvals).set({
      status: action,
      reviewedBy: body.reviewedBy || "operator",
      reviewedAt: new Date(),
    }).where(eq(approvals.id, id));

    return c.json({ id, status: action });
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
