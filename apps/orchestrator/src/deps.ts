import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@clab/db";
import { createLogger } from "@clab/telemetry";
import { EventBus, createEvent } from "@clab/events";
import type { EventContext } from "@clab/events";

const logger = createLogger("orchestrator");

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://clab:clab-stg-pass@postgres:5432/clab";
const sql = postgres(DATABASE_URL);
export const db = drizzle(sql, { schema });

export { logger };

// --- EventBus (replaces raw NATS) ---

const eventBus = new EventBus();
let eventBusConnected = false;

export async function connectEventBus(): Promise<void> {
  if (eventBusConnected) return;
  const url = process.env.NATS_URL || "nats://nats:4222";
  try {
    await eventBus.connect(url);
    eventBusConnected = true;
    logger.info("EventBus connected", { url });
  } catch (err) {
    logger.error("EventBus connection failed", { url, error: String(err) });
  }
}

export async function publishEvent(
  type: string,
  payload: Record<string, unknown>,
  context: EventContext = {},
): Promise<void> {
  try {
    if (!eventBusConnected) await connectEventBus();
    const actor = context.actor ?? { kind: "system" as const, id: "orchestrator" };
    const event = createEvent(type, payload, { ...context, actor });
    await eventBus.publish(event);

    // Audit: persist to events table
    await persistEvent(type, payload, actor, context);
  } catch (err) {
    logger.error("Failed to publish event", { type, error: String(err) });
  }
}

/** Persist event to DB events table for audit trail */
async function persistEvent(
  type: string,
  payload: Record<string, unknown>,
  actor: { kind: string; id: string },
  context: EventContext,
): Promise<void> {
  try {
    const { events } = await import("@clab/db");
    await db.insert(events).values({
      type,
      version: 1,
      occurredAt: new Date(),
      missionId: context.missionId ?? null,
      waveId: context.waveId ?? null,
      taskId: context.taskId ?? null,
      taskRunId: context.taskRunId ?? null,
      sessionId: context.sessionId ?? null,
      workspaceId: context.workspaceId ?? null,
      actorKind: actor.kind,
      actorId: actor.id,
      payload,
    });
  } catch (err) {
    // Don't fail the main flow if audit logging fails
    logger.warn("Failed to persist audit event", { type, error: String(err) });
  }
}

export { eventBus };
