import { eq, and, inArray } from "drizzle-orm";
import { waves, tasks } from "@clab/db";
import type { Database } from "@clab/db";
import { assertTransition, WAVE_TRANSITIONS, TASK_TRANSITIONS } from "@clab/domain";
import { EventBus, createEvent } from "@clab/events";
import { createLogger } from "@clab/telemetry";

const logger = createLogger("orchestrator:scheduler");

/** Terminal task statuses — a task in any of these will not run again. */
const TERMINAL_TASK_STATUSES = ["SUCCEEDED", "FAILED", "CANCELLED"] as const;

// ---------------------------------------------------------------------------
// WaveScheduler
// ---------------------------------------------------------------------------

export class WaveScheduler {
  constructor(
    private readonly db: Database,
    private readonly bus: EventBus,
  ) {}

  /**
   * Find the next PENDING wave for a mission where all dependency waves are COMPLETED,
   * transition it to READY then RUNNING, and return it.
   * Returns null if no wave is eligible.
   */
  async scheduleNext(missionId: string): Promise<typeof waves.$inferSelect | null> {
    // Get all waves for this mission, ordered by ordinal
    const missionWaves = await this.db
      .select()
      .from(waves)
      .where(eq(waves.missionId, missionId))
      .orderBy(waves.ordinal);

    if (missionWaves.length === 0) {
      logger.warn("No waves found for mission", { missionId });
      return null;
    }

    // Build a status map for quick lookup
    const statusMap = new Map(missionWaves.map((w) => [w.id, w.status]));

    // Find the first PENDING wave whose preceding waves are all COMPLETED
    for (const wave of missionWaves) {
      if (wave.status !== "PENDING") continue;

      // All waves with a lower ordinal must be COMPLETED
      const precedingWaves = missionWaves.filter((w) => w.ordinal < wave.ordinal);
      const allPrecedingDone = precedingWaves.every(
        (w) => statusMap.get(w.id) === "COMPLETED",
      );

      if (!allPrecedingDone) continue;

      // Transition: PENDING → READY
      assertTransition(WAVE_TRANSITIONS, "PENDING", "READY");
      await this.db
        .update(waves)
        .set({ status: "READY" })
        .where(eq(waves.id, wave.id));

      await this.bus.publish(
        createEvent("wave.ready", {
          index: wave.ordinal,
          resolvedDependencies: precedingWaves.map((w) => w.id),
        }, { missionId, waveId: wave.id }),
      );

      // Transition: READY → RUNNING
      assertTransition(WAVE_TRANSITIONS, "READY", "RUNNING");
      const now = new Date();
      await this.db
        .update(waves)
        .set({ status: "RUNNING", startedAt: now })
        .where(eq(waves.id, wave.id));

      await this.bus.publish(
        createEvent("wave.started", {
          index: wave.ordinal,
          startedAt: now.toISOString(),
        }, { missionId, waveId: wave.id }),
      );

      // Queue all tasks in this wave
      const waveTasks = await this.db
        .select()
        .from(tasks)
        .where(eq(tasks.waveId, wave.id));

      for (const task of waveTasks) {
        if (task.status === "QUEUED") {
          await this.bus.publish(
            createEvent("task.queued", {
              queuePosition: 0,
              reason: `Wave ${wave.ordinal} started`,
            }, { missionId, waveId: wave.id, taskId: task.id }),
          );
        }
      }

      logger.info("Scheduled wave", {
        missionId,
        waveId: wave.id,
        ordinal: wave.ordinal,
        taskCount: waveTasks.length,
      });

      return { ...wave, status: "RUNNING", startedAt: now };
    }

    logger.debug("No eligible wave to schedule", { missionId });
    return null;
  }

  /**
   * Check whether all tasks in a wave have reached a terminal status.
   *
   * - If all tasks SUCCEEDED → wave transitions to COMPLETED.
   * - If any task FAILED and has exhausted retries → wave transitions to FAILED.
   * - Otherwise the wave is still in progress → returns false.
   */
  async checkWaveCompletion(waveId: string): Promise<boolean> {
    const waveTasks = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.waveId, waveId));

    if (waveTasks.length === 0) return true;

    const allTerminal = waveTasks.every((t) =>
      (TERMINAL_TASK_STATUSES as readonly string[]).includes(t.status),
    );

    if (!allTerminal) return false;

    // Determine wave outcome
    const allSucceeded = waveTasks.every((t) => t.status === "SUCCEEDED");
    const anyFailed = waveTasks.some((t) => t.status === "FAILED");

    // Get the wave record for context
    const [wave] = await this.db
      .select()
      .from(waves)
      .where(eq(waves.id, waveId))
      .limit(1);

    if (!wave) {
      logger.error("Wave not found during completion check", { waveId });
      return false;
    }

    const now = new Date();

    if (allSucceeded) {
      assertTransition(WAVE_TRANSITIONS, wave.status as "RUNNING", "COMPLETED");
      await this.db
        .update(waves)
        .set({ status: "COMPLETED", completedAt: now })
        .where(eq(waves.id, waveId));

      const startTime = wave.startedAt ? new Date(wave.startedAt).getTime() : now.getTime();
      const elapsedMs = now.getTime() - startTime;

      await this.bus.publish(
        createEvent("wave.completed", {
          index: wave.ordinal,
          elapsedMs,
          taskResults: waveTasks.map((t) => ({
            taskId: t.id,
            status: t.status,
          })),
        }, { missionId: wave.missionId, waveId }),
      );

      logger.info("Wave completed", { waveId, ordinal: wave.ordinal });
      return true;
    }

    if (anyFailed) {
      const failedTasks = waveTasks.filter((t) => t.status === "FAILED");

      assertTransition(WAVE_TRANSITIONS, wave.status as "RUNNING", "FAILED");
      await this.db
        .update(waves)
        .set({ status: "FAILED", completedAt: now })
        .where(eq(waves.id, waveId));

      await this.bus.publish(
        createEvent("wave.failed", {
          index: wave.ordinal,
          reason: `${failedTasks.length} task(s) failed`,
          failedTaskIds: failedTasks.map((t) => t.id),
        }, { missionId: wave.missionId, waveId }),
      );

      logger.warn("Wave failed", {
        waveId,
        ordinal: wave.ordinal,
        failedCount: failedTasks.length,
      });
      return true;
    }

    // All cancelled — treat as completed
    assertTransition(WAVE_TRANSITIONS, wave.status as "RUNNING", "COMPLETED");
    await this.db
      .update(waves)
      .set({ status: "COMPLETED", completedAt: now })
      .where(eq(waves.id, waveId));

    logger.info("Wave completed (all tasks cancelled)", { waveId });
    return true;
  }

  /**
   * Pause a running wave: transition RUNNING → BLOCKED and cancel queued tasks.
   */
  async pauseWave(waveId: string): Promise<void> {
    const [wave] = await this.db
      .select()
      .from(waves)
      .where(eq(waves.id, waveId))
      .limit(1);

    if (!wave) throw new Error(`Wave ${waveId} not found`);

    assertTransition(WAVE_TRANSITIONS, wave.status as "RUNNING", "BLOCKED");

    await this.db
      .update(waves)
      .set({ status: "BLOCKED" })
      .where(eq(waves.id, waveId));

    // Cancel any QUEUED tasks
    await this.db
      .update(tasks)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(
        and(
          eq(tasks.waveId, waveId),
          eq(tasks.status, "QUEUED"),
        ),
      );

    logger.info("Wave paused", { waveId, ordinal: wave.ordinal });
  }
}
