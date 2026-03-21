import { connect, JSONCodec } from "nats";
import type { NatsConnection } from "nats";
import { db } from "./app.js";
import * as schema from "@clab/db";
import { eq } from "drizzle-orm";
import { SESSION_TRANSITIONS, canTransition } from "@clab/domain";
import type { SessionState } from "@clab/domain";

const { agentSessions, taskRuns } = schema;
const NATS_URL = process.env.NATS_URL || "nats://nats:4222";
const WORKSPACE_ID = process.env.DEFAULT_WORKSPACE_ID || "19914994-4c4c-4e5a-80e0-e6d7a1863535";
const jc = JSONCodec();

let nc: NatsConnection | null = null;

export function getNatsConnection(): NatsConnection | null {
  return nc;
}

export async function stopSessionManager(): Promise<void> {
  if (nc) {
    await nc.drain();
    nc = null;
    console.log("[runtime-manager] NATS connection drained");
  }
}

/**
 * Safely transition a session state. Returns true if transition is valid.
 */
function isValidSessionTransition(from: string, to: string): boolean {
  // Validate both states are known SessionState values
  const validStates = Object.keys(SESSION_TRANSITIONS);
  if (!validStates.includes(from) || !validStates.includes(to)) {
    return false;
  }
  return canTransition(SESSION_TRANSITIONS, from as SessionState, to as SessionState);
}

export async function startSessionManager(): Promise<void> {
  try {
    nc = await connect({ servers: NATS_URL });
    console.log("[runtime-manager] Connected to NATS");

    // Subscribe to task.assigned — provision session for each task
    const sub = nc.subscribe("clab.*.task.assigned");

    (async () => {
      for await (const msg of sub) {
        try {
          const data = jc.decode(msg.data) as Record<string, unknown>;
          await provisionSession(data);
        } catch (err) {
          console.error("[runtime-manager] Error provisioning session:", err);
        }
      }
    })();

    // Subscribe to task.completed — close session
    const completeSub = nc.subscribe("clab.*.task.completed");

    (async () => {
      for await (const msg of completeSub) {
        try {
          const data = jc.decode(msg.data) as Record<string, unknown>;
          await handleTaskCompleted(data);
        } catch (err) {
          console.error("[runtime-manager] Error handling completion:", err);
        }
      }
    })();
  } catch (err) {
    console.error("[runtime-manager] NATS connection failed:", err);
  }
}

async function provisionSession(data: Record<string, unknown>): Promise<void> {
  const taskId = data.taskId as string;
  const role = data.role as string;
  const engine = data.engine as string;

  // Check for existing idle session with same role
  const existing = await db.select().from(agentSessions)
    .where(eq(agentSessions.role, role));
  const idleSession = existing.find(s => s.state === "IDLE");

  let sessionId: string;

  if (idleSession) {
    // Reuse existing session — validate state transition
    sessionId = idleSession.id;
    const currentState = idleSession.state;
    const targetState = "RUNNING";
    if (!isValidSessionTransition(currentState, targetState)) {
      console.error(`[runtime-manager] Invalid transition ${currentState} → ${targetState} for session ${sessionId}`);
      return;
    }
    await db.update(agentSessions).set({
      state: targetState,
      lastHeartbeat: new Date(),
    }).where(eq(agentSessions.id, sessionId));
    console.log(`[runtime-manager] Reused session ${sessionId} for ${role}`);
  } else {
    // Create new session
    const [session] = await db.insert(agentSessions).values({
      workspaceId: WORKSPACE_ID,
      role,
      engine,
      state: "RUNNING",
      lastHeartbeat: new Date(),
      metadata: { taskId },
    }).returning();
    sessionId = session.id;
    console.log(`[runtime-manager] Created session ${sessionId} for ${role}`);
  }

  // Emit session.provisioned event
  if (nc) {
    nc.publish("clab.session.provisioned", jc.encode({
      sessionId,
      taskId,
      role,
      engine,
    }));
  }
}

async function handleTaskCompleted(data: Record<string, unknown>): Promise<void> {
  const taskId = data.taskId as string;

  // Find session for this task
  const sessions = await db.select().from(agentSessions);
  const session = sessions.find(s => {
    const meta = s.metadata as Record<string, unknown> | null;
    return meta?.taskId === taskId && s.state === "RUNNING";
  });

  if (session) {
    // Set session to IDLE (ready for reuse) — validate state transition
    const currentState = session.state;
    const targetState = "IDLE";
    if (!isValidSessionTransition(currentState, targetState)) {
      console.error(`[runtime-manager] Invalid transition ${currentState} → ${targetState} for session ${session.id}`);
      return;
    }
    await db.update(agentSessions).set({
      state: targetState,
      lastHeartbeat: new Date(),
    }).where(eq(agentSessions.id, session.id));
    console.log(`[runtime-manager] Session ${session.id} → IDLE (task ${taskId} done)`);

    if (nc) {
      nc.publish("clab.session.released", jc.encode({
        sessionId: session.id,
        taskId,
      }));
    }
  }
}
