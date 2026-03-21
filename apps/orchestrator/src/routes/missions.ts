import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { missions, plans, waves, tasks } from "@clab/db";
import {
  assertTransition,
  MISSION_TRANSITIONS,
  type MissionStatus,
} from "@clab/domain";
import { createEvent } from "@clab/events";
import { createLogger } from "@clab/telemetry";
import { getDb, getBus, getPlanner, getScheduler } from "../deps.js";

const logger = createLogger("orchestrator:missions");

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const CreateMissionInput = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().min(1).max(500),
  objective: z.string().min(1),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).default("NORMAL"),
  constraints: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const missionRoutes = new Hono()

  // POST / — Create mission
  .post("/", async (c) => {
    const body = await c.req.json();
    const input = CreateMissionInput.safeParse(body);
    if (!input.success) {
      return c.json({ error: "Validation failed", details: input.error.flatten() }, 400);
    }

    const db = getDb();
    const bus = getBus();
    const { workspaceId, title, objective, priority, constraints, acceptanceCriteria } = input.data;

    const [mission] = await db
      .insert(missions)
      .values({
        workspaceId,
        title,
        objective,
        status: "DRAFT",
        priority,
        constraints,
        acceptanceCriteria,
      })
      .returning();

    if (!mission) {
      return c.json({ error: "Failed to create mission" }, 500);
    }

    try {
      await bus.publish(
        createEvent("mission.created", {
          title: mission.title,
          description: mission.objective,
          createdBy: "system",
        }, {
          missionId: mission.id,
          workspaceId: mission.workspaceId,
        }),
      );
    } catch (err) {
      logger.warn("Failed to emit mission.created event", { error: String(err) });
    }

    logger.info("Mission created", { missionId: mission.id, title });

    return c.json({ mission }, 201);
  })

  // GET /:id — Get mission by ID
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const db = getDb();

    const [mission] = await db
      .select()
      .from(missions)
      .where(eq(missions.id, id))
      .limit(1);

    if (!mission) {
      return c.json({ error: "Mission not found" }, 404);
    }

    // Include waves and tasks for a complete view
    const missionWaves = await db
      .select()
      .from(waves)
      .where(eq(waves.missionId, id))
      .orderBy(waves.ordinal);

    const missionTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.missionId, id));

    const missionPlans = await db
      .select()
      .from(plans)
      .where(eq(plans.missionId, id));

    return c.json({
      mission,
      plans: missionPlans,
      waves: missionWaves,
      tasks: missionTasks,
    });
  })

  // POST /:id/plan — Plan mission
  .post("/:id/plan", async (c) => {
    const id = c.req.param("id");
    const db = getDb();
    const bus = getBus();
    const planner = getPlanner();

    // Fetch mission
    const [mission] = await db
      .select()
      .from(missions)
      .where(eq(missions.id, id))
      .limit(1);

    if (!mission) {
      return c.json({ error: "Mission not found" }, 404);
    }

    // Validate state transition: must be DRAFT or FAILED to re-plan
    if (mission.status !== "DRAFT" && mission.status !== "FAILED") {
      return c.json({
        error: `Cannot plan mission in ${mission.status} status. Must be DRAFT or FAILED.`,
      }, 409);
    }

    // Run the planner
    const planResult = await planner.plan(
      mission.id,
      mission.objective,
      (mission.constraints as string[]) ?? [],
    );

    // Deactivate any previous plans
    await db
      .update(plans)
      .set({ isActive: false })
      .where(eq(plans.missionId, id));

    // Insert plan
    const [plan] = await db
      .insert(plans)
      .values({
        missionId: mission.id,
        summary: planResult.summary,
        waveCount: planResult.waves.length,
        isActive: true,
      })
      .returning();

    if (!plan) {
      return c.json({ error: "Failed to create plan" }, 500);
    }

    // Insert waves and tasks
    const createdWaves: (typeof waves.$inferSelect)[] = [];
    const createdTasks: (typeof tasks.$inferSelect)[] = [];

    for (const plannedWave of planResult.waves) {
      const [wave] = await db
        .insert(waves)
        .values({
          planId: plan.id,
          missionId: mission.id,
          ordinal: plannedWave.index,
          label: plannedWave.label,
          status: "PENDING",
          directive: plannedWave.directive,
        })
        .returning();

      if (!wave) continue;
      createdWaves.push(wave);

      for (const plannedTask of plannedWave.tasks) {
        const [task] = await db
          .insert(tasks)
          .values({
            waveId: wave.id,
            missionId: mission.id,
            title: plannedTask.title,
            description: plannedTask.instruction,
            role: plannedTask.role,
            engine: plannedTask.engine,
            status: "QUEUED",
            acceptanceCriteria: plannedTask.acceptanceCriteria,
            maxRetries: plannedTask.maxRetries,
            timeoutMs: plannedTask.timeoutMs,
          })
          .returning();

        if (task) createdTasks.push(task);
      }
    }

    // Transition mission to PLANNED
    const targetStatus: MissionStatus = "PLANNED";
    assertTransition(MISSION_TRANSITIONS, mission.status as MissionStatus, targetStatus);

    await db
      .update(missions)
      .set({ status: targetStatus, updatedAt: new Date() })
      .where(eq(missions.id, id));

    try {
      await bus.publish(
        createEvent("mission.planned", {
          waveCount: createdWaves.length,
          taskCount: createdTasks.length,
          planSummary: planResult.summary,
        }, { missionId: mission.id, workspaceId: mission.workspaceId }),
      );
    } catch (err) {
      logger.warn("Failed to emit mission.planned event", { error: String(err) });
    }

    logger.info("Mission planned", {
      missionId: mission.id,
      planId: plan.id,
      waveCount: createdWaves.length,
      taskCount: createdTasks.length,
    });

    return c.json({
      plan,
      waves: createdWaves,
      tasks: createdTasks,
      summary: planResult.summary,
      assumptions: planResult.assumptions,
    });
  })

  // POST /:id/start — Start mission
  .post("/:id/start", async (c) => {
    const id = c.req.param("id");
    const db = getDb();
    const bus = getBus();
    const scheduler = getScheduler();

    const [mission] = await db
      .select()
      .from(missions)
      .where(eq(missions.id, id))
      .limit(1);

    if (!mission) {
      return c.json({ error: "Mission not found" }, 404);
    }

    // Must be PLANNED to start
    assertTransition(MISSION_TRANSITIONS, mission.status as MissionStatus, "RUNNING");

    await db
      .update(missions)
      .set({ status: "RUNNING", updatedAt: new Date() })
      .where(eq(missions.id, id));

    const startedAt = new Date().toISOString();

    try {
      await bus.publish(
        createEvent("mission.started", { startedAt }, {
          missionId: mission.id,
          workspaceId: mission.workspaceId,
        }),
      );
    } catch (err) {
      logger.warn("Failed to emit mission.started event", { error: String(err) });
    }

    // Schedule the first wave
    const firstWave = await scheduler.scheduleNext(mission.id);

    logger.info("Mission started", {
      missionId: mission.id,
      firstWaveId: firstWave?.id ?? null,
    });

    return c.json({
      mission: { ...mission, status: "RUNNING" },
      currentWave: firstWave,
      startedAt,
    });
  })

  // POST /:id/abort — Abort mission
  .post("/:id/abort", async (c) => {
    const id = c.req.param("id");
    const db = getDb();
    const bus = getBus();

    const [mission] = await db
      .select()
      .from(missions)
      .where(eq(missions.id, id))
      .limit(1);

    if (!mission) {
      return c.json({ error: "Mission not found" }, 404);
    }

    const currentStatus = mission.status as MissionStatus;
    assertTransition(MISSION_TRANSITIONS, currentStatus, "ABORTED");

    const now = new Date();

    // Abort the mission
    await db
      .update(missions)
      .set({ status: "ABORTED", updatedAt: now, completedAt: now })
      .where(eq(missions.id, id));

    // Cancel all non-terminal tasks
    const missionTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.missionId, id));

    const cancellableStatuses = ["QUEUED", "ASSIGNED", "RUNNING", "BLOCKED"];
    let cancelledCount = 0;

    for (const task of missionTasks) {
      if (cancellableStatuses.includes(task.status)) {
        await db
          .update(tasks)
          .set({ status: "CANCELLED", updatedAt: now })
          .where(eq(tasks.id, task.id));
        cancelledCount++;
      }
    }

    // Fail all non-terminal waves
    const missionWaves = await db
      .select()
      .from(waves)
      .where(eq(waves.missionId, id));

    const activeWaveStatuses = ["PENDING", "READY", "RUNNING", "BLOCKED"];
    for (const wave of missionWaves) {
      if (activeWaveStatuses.includes(wave.status)) {
        await db
          .update(waves)
          .set({ status: "FAILED", completedAt: now })
          .where(eq(waves.id, wave.id));
      }
    }

    try {
      await bus.publish(
        createEvent("mission.failed", {
          reason: "Mission aborted by user",
          retriable: false,
        }, { missionId: mission.id, workspaceId: mission.workspaceId }),
      );
    } catch (err) {
      logger.warn("Failed to emit mission.failed event", { error: String(err) });
    }

    logger.info("Mission aborted", {
      missionId: mission.id,
      cancelledTasks: cancelledCount,
    });

    return c.json({
      mission: { ...mission, status: "ABORTED" },
      cancelledTasks: cancelledCount,
    });
  });
