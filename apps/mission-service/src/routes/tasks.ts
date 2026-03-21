import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { tasks, taskRuns, waves } from "@clab/db";
import {
  assertTransition,
  TASK_TRANSITIONS,
  type TaskStatus,
} from "@clab/domain";
import { createEvent } from "@clab/events";
import { createLogger } from "@clab/telemetry";
import { getDb, getBus, getRouter, getScheduler } from "../deps.js";

const logger = createLogger("mission-service:tasks");

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const CreateTaskInput = z.object({
  missionId: z.string().uuid(),
  waveId: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().min(1),
  role: z.enum(["PM", "OPERATIONS_REVIEWER", "BUILDER", "ARCHITECT", "STRATEGIST", "RESEARCH_ANALYST"]).optional(),
  engine: z.enum(["CODEX", "CLAUDE", "BROWSER"]).optional(),
  acceptanceCriteria: z.array(z.string()).default([]),
  maxRetries: z.number().int().min(0).max(5).default(2),
  timeoutMs: z.number().int().min(10_000).max(3_600_000).default(300_000),
});

const ReviewInput = z.object({
  reviewedBy: z.string().min(1),
  passed: z.boolean(),
  reason: z.string().optional(),
  comments: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const taskRoutes = new Hono()

  // POST / — Dispatch (create) a task
  .post("/", async (c) => {
    const body = await c.req.json();
    const input = CreateTaskInput.safeParse(body);
    if (!input.success) {
      return c.json({ error: "Validation failed", details: input.error.flatten() }, 400);
    }

    const db = getDb();
    const bus = getBus();
    const router = getRouter();
    const { missionId, waveId, title, description, acceptanceCriteria, maxRetries, timeoutMs } = input.data;

    // Determine role + engine via router if not explicitly provided
    let role = input.data.role;
    let engine = input.data.engine;

    if (!role) {
      const routed = router.route(description);
      role = routed.role;
      engine = engine ?? routed.engine;
    }

    if (!engine) {
      engine = router.engineForRole(role);
    }

    // Verify the wave exists and belongs to the mission
    const [wave] = await db
      .select()
      .from(waves)
      .where(and(eq(waves.id, waveId), eq(waves.missionId, missionId)))
      .limit(1);

    if (!wave) {
      return c.json({ error: "Wave not found or does not belong to mission" }, 404);
    }

    const [task] = await db
      .insert(tasks)
      .values({
        waveId,
        missionId,
        title,
        description,
        role,
        engine,
        status: "QUEUED",
        acceptanceCriteria,
        maxRetries,
        timeoutMs,
      })
      .returning();

    if (!task) {
      return c.json({ error: "Failed to create task" }, 500);
    }

    try {
      await bus.publish(
        createEvent("task.created", {
          title: task.title,
          role: task.role,
        }, { missionId, waveId, taskId: task.id }),
      );
    } catch (err) {
      logger.warn("Failed to emit task.created event", { error: String(err) });
    }

    logger.info("Task dispatched", { taskId: task.id, role, engine, waveId });

    return c.json({ task }, 201);
  })

  // GET / — List tasks (optional missionId filter)
  .get("/", async (c) => {
    const db = getDb();
    const missionId = c.req.query("missionId");
    const waveId = c.req.query("waveId");
    const status = c.req.query("status");

    let query = db.select().from(tasks).$dynamic();

    const conditions = [];
    if (missionId) conditions.push(eq(tasks.missionId, missionId));
    if (waveId) conditions.push(eq(tasks.waveId, waveId));
    if (status) conditions.push(eq(tasks.status, status));

    if (conditions.length === 1) {
      query = query.where(conditions[0]!);
    } else if (conditions.length > 1) {
      query = query.where(and(...conditions));
    }

    const result = await query;
    return c.json({ tasks: result });
  })

  // GET /:id — Get task by ID
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const db = getDb();

    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    // Include task runs
    const runs = await db
      .select()
      .from(taskRuns)
      .where(eq(taskRuns.taskId, id));

    return c.json({ task, runs });
  })

  // POST /:id/retry — Retry a failed task
  .post("/:id/retry", async (c) => {
    const id = c.req.param("id");
    const db = getDb();
    const bus = getBus();

    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    // Must be FAILED to retry
    if (task.status !== "FAILED") {
      return c.json({ error: `Cannot retry task in ${task.status} status. Must be FAILED.` }, 409);
    }

    // Check retry limit
    const existingRuns = await db
      .select()
      .from(taskRuns)
      .where(eq(taskRuns.taskId, id));

    if (existingRuns.length >= task.maxRetries + 1) {
      return c.json({
        error: `Task has exhausted all ${task.maxRetries} retries (${existingRuns.length} attempts made)`,
      }, 409);
    }

    // Transition FAILED → QUEUED
    assertTransition(TASK_TRANSITIONS, "FAILED", "QUEUED");

    await db
      .update(tasks)
      .set({ status: "QUEUED", updatedAt: new Date() })
      .where(eq(tasks.id, id));

    try {
      await bus.publish(
        createEvent("task.queued", {
          reason: `Retry attempt ${existingRuns.length + 1}`,
        }, { missionId: task.missionId, waveId: task.waveId, taskId: task.id }),
      );
    } catch (err) {
      logger.warn("Failed to emit task.queued event", { error: String(err) });
    }

    logger.info("Task queued for retry", {
      taskId: task.id,
      attempt: existingRuns.length + 1,
      maxRetries: task.maxRetries,
    });

    return c.json({
      task: { ...task, status: "QUEUED" },
      attempt: existingRuns.length + 1,
    });
  })

  // POST /:id/review — Submit review result (pass/fail)
  .post("/:id/review", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const input = ReviewInput.safeParse(body);
    if (!input.success) {
      return c.json({ error: "Validation failed", details: input.error.flatten() }, 400);
    }

    const db = getDb();
    const bus = getBus();
    const scheduler = getScheduler();
    const { reviewedBy, passed, reason, comments } = input.data;

    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    // Must be in NEEDS_REVIEW to accept review
    if (task.status !== "NEEDS_REVIEW") {
      return c.json({
        error: `Cannot review task in ${task.status} status. Must be NEEDS_REVIEW.`,
      }, 409);
    }

    const now = new Date();

    if (passed) {
      // NEEDS_REVIEW → SUCCEEDED
      assertTransition(TASK_TRANSITIONS, "NEEDS_REVIEW", "SUCCEEDED");

      await db
        .update(tasks)
        .set({ status: "SUCCEEDED", updatedAt: now, completedAt: now })
        .where(eq(tasks.id, id));

      try {
        await bus.publish(
          createEvent("task.review_passed", {
            reviewedBy,
            comments: comments ?? null,
          }, { missionId: task.missionId, waveId: task.waveId, taskId: task.id }),
        );
      } catch (err) {
        logger.warn("Failed to emit task.review_passed event", { error: String(err) });
      }

      logger.info("Task review passed", { taskId: task.id, reviewedBy });
    } else {
      // NEEDS_REVIEW → FAILED
      assertTransition(TASK_TRANSITIONS, "NEEDS_REVIEW", "FAILED");

      await db
        .update(tasks)
        .set({ status: "FAILED", updatedAt: now })
        .where(eq(tasks.id, id));

      try {
        await bus.publish(
          createEvent("task.review_failed", {
            reviewedBy,
            reason: reason ?? "Review failed",
            comments: comments ?? null,
          }, { missionId: task.missionId, waveId: task.waveId, taskId: task.id }),
        );
      } catch (err) {
        logger.warn("Failed to emit task.review_failed event", { error: String(err) });
      }

      logger.info("Task review failed", { taskId: task.id, reviewedBy, reason });
    }

    // Check if the wave is now complete
    const waveComplete = await scheduler.checkWaveCompletion(task.waveId);

    // If wave completed, try scheduling the next one
    let nextWave = null;
    if (waveComplete) {
      nextWave = await scheduler.scheduleNext(task.missionId);
    }

    return c.json({
      task: { ...task, status: passed ? "SUCCEEDED" : "FAILED" },
      waveComplete,
      nextWave,
    });
  });
