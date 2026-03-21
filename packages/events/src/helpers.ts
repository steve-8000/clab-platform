import { randomUUID } from "node:crypto";
import type { EventEnvelope, Actor } from "./envelope.js";

export interface EventContext {
  missionId?: string;
  waveId?: string;
  taskId?: string;
  taskRunId?: string;
  sessionId?: string;
  workspaceId?: string;
  actor?: Actor;
}

/**
 * Create a fully-formed EventEnvelope ready for publishing.
 *
 * If no actor is provided, defaults to { kind: "system", id: "clab" }.
 */
export function createEvent(
  type: string,
  payload: Record<string, unknown>,
  context: EventContext = {},
): EventEnvelope {
  return {
    id: randomUUID(),
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    ...(context.missionId !== undefined && { missionId: context.missionId }),
    ...(context.waveId !== undefined && { waveId: context.waveId }),
    ...(context.taskId !== undefined && { taskId: context.taskId }),
    ...(context.taskRunId !== undefined && { taskRunId: context.taskRunId }),
    ...(context.sessionId !== undefined && { sessionId: context.sessionId }),
    ...(context.workspaceId !== undefined && { workspaceId: context.workspaceId }),
    actor: context.actor ?? { kind: "system", id: "clab" },
    payload,
  };
}
