import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { waves, tasks } from "@clab/db";
import { assertTransition, WAVE_TRANSITIONS, type WaveStatus } from "@clab/domain";
import { createEvent } from "@clab/events";
import { createLogger } from "@clab/telemetry";
import { getDb, getBus, getScheduler } from "../deps.js";

const logger = createLogger("orchestrator:waves");

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const waveRoutes = new Hono()

  // GET /:missionId — List waves for a mission
  .get("/:missionId", async (c) => {
    const missionId = c.req.param("missionId");
    const db = getDb();

    const missionWaves = await db
      .select()
      .from(waves)
      .where(eq(waves.missionId, missionId))
      .orderBy(waves.ordinal);

    // Attach task counts per wave
    const wavesWithCounts = await Promise.all(
      missionWaves.map(async (wave) => {
        const waveTasks = await db
          .select()
          .from(tasks)
          .where(eq(tasks.waveId, wave.id));

        const statusCounts: Record<string, number> = {};
        for (const task of waveTasks) {
          statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
        }

        return {
          ...wave,
          taskCount: waveTasks.length,
          taskStatusCounts: statusCounts,
        };
      }),
    );

    return c.json({ waves: wavesWithCounts });
  })

  // POST /:id/release — Release (start) a wave
  .post("/:id/release", async (c) => {
    const id = c.req.param("id");
    const db = getDb();
    const bus = getBus();

    const [wave] = await db
      .select()
      .from(waves)
      .where(eq(waves.id, id))
      .limit(1);

    if (!wave) {
      return c.json({ error: "Wave not found" }, 404);
    }

    const currentStatus = wave.status as WaveStatus;

    // Accept PENDING or BLOCKED waves for release
    if (currentStatus !== "PENDING" && currentStatus !== "BLOCKED") {
      return c.json({
        error: `Cannot release wave in ${currentStatus} status. Must be PENDING or BLOCKED.`,
      }, 409);
    }

    // Transition to READY
    assertTransition(WAVE_TRANSITIONS, currentStatus, "READY");
    await db
      .update(waves)
      .set({ status: "READY" })
      .where(eq(waves.id, id));

    await safePublish(bus, createEvent("wave.ready", {
      index: wave.ordinal,
    }, { missionId: wave.missionId, waveId: wave.id }));

    // Transition READY → RUNNING
    assertTransition(WAVE_TRANSITIONS, "READY", "RUNNING");
    const now = new Date();
    await db
      .update(waves)
      .set({ status: "RUNNING", startedAt: now })
      .where(eq(waves.id, id));

    await safePublish(bus, createEvent("wave.started", {
      index: wave.ordinal,
      startedAt: now.toISOString(),
    }, { missionId: wave.missionId, waveId: wave.id }));

    // Queue all QUEUED tasks in this wave
    const waveTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.waveId, id));

    let queuedCount = 0;
    for (const task of waveTasks) {
      if (task.status === "QUEUED") {
        await safePublish(bus, createEvent("task.queued", {
          queuePosition: queuedCount,
          reason: `Wave ${wave.ordinal} released`,
        }, {
          missionId: wave.missionId,
          waveId: wave.id,
          taskId: task.id,
        }));
        queuedCount++;
      }
    }

    // Re-queue any BLOCKED tasks that were blocked from a previous pause
    for (const task of waveTasks) {
      if (task.status === "BLOCKED") {
        assertTransition(
          { BLOCKED: ["QUEUED", "CANCELLED"] } as any,
          "BLOCKED",
          "QUEUED",
        );
        await db
          .update(tasks)
          .set({ status: "QUEUED", updatedAt: now })
          .where(eq(tasks.id, task.id));
        queuedCount++;
      }
    }

    logger.info("Wave released", {
      waveId: wave.id,
      ordinal: wave.ordinal,
      tasksQueued: queuedCount,
    });

    return c.json({
      wave: { ...wave, status: "RUNNING", startedAt: now },
      tasksQueued: queuedCount,
    });
  })

  // POST /:id/pause — Pause a running wave
  .post("/:id/pause", async (c) => {
    const id = c.req.param("id");
    const scheduler = getScheduler();

    const db = getDb();
    const [wave] = await db
      .select()
      .from(waves)
      .where(eq(waves.id, id))
      .limit(1);

    if (!wave) {
      return c.json({ error: "Wave not found" }, 404);
    }

    if (wave.status !== "RUNNING") {
      return c.json({
        error: `Cannot pause wave in ${wave.status} status. Must be RUNNING.`,
      }, 409);
    }

    await scheduler.pauseWave(id);

    // Count remaining active tasks
    const waveTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.waveId, id));

    const activeTasks = waveTasks.filter(
      (t) => t.status === "RUNNING" || t.status === "ASSIGNED",
    );
    const cancelledTasks = waveTasks.filter((t) => t.status === "CANCELLED");

    logger.info("Wave paused", {
      waveId: wave.id,
      ordinal: wave.ordinal,
      activeTasks: activeTasks.length,
      cancelledTasks: cancelledTasks.length,
    });

    return c.json({
      wave: { ...wave, status: "BLOCKED" },
      activeTasks: activeTasks.length,
      cancelledTasks: cancelledTasks.length,
    });
  });

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function safePublish(bus: import("@clab/events").EventBus, event: import("@clab/events").EventEnvelope): Promise<void> {
  try {
    await bus.publish(event);
  } catch (err) {
    logger.warn("Failed to publish event", { type: event.type, error: String(err) });
  }
}
