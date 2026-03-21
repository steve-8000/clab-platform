import { db } from "./app.js";
import * as schema from "@clab/db";
import { eq } from "drizzle-orm";
import { EventBus, createEvent } from "@clab/events";
import type { EventEnvelope } from "@clab/events";
import {
  SESSION_TRANSITIONS,
  assertTransition,
  canTransition,
} from "@clab/domain";
import {
  type SessionLease,
  isLeaseExpired,
  canRenewLease,
  renewLease,
  HEARTBEAT_INTERVAL_MS,
} from "@clab/runtime-contracts";

const { agentSessions, capabilityLeases } = schema;
const NATS_URL = process.env.NATS_URL || "nats://nats:4222";
const WORKSPACE_ID = process.env.DEFAULT_WORKSPACE_ID || "19914994-4c4c-4e5a-80e0-e6d7a1863535";

const eventBus = new EventBus();

export async function startSessionManager(): Promise<void> {
  try {
    await eventBus.connect(NATS_URL);
    console.log("[runtime-manager] EventBus connected");

    // Subscribe to task.assigned — provision session for each task
    await eventBus.subscribe("task.assigned", async (event: EventEnvelope) => {
      try {
        await provisionSession(event);
      } catch (err) {
        console.error("[runtime-manager] Error provisioning session:", err);
      }
    });

    // Subscribe to task.run.completed — release session
    await eventBus.subscribe("task.run.completed", async (event: EventEnvelope) => {
      try {
        await handleTaskCompleted(event);
      } catch (err) {
        console.error("[runtime-manager] Error handling completion:", err);
      }
    });
  } catch (err) {
    console.error("[runtime-manager] EventBus connection failed:", err);
  }
}

async function provisionSession(event: EventEnvelope): Promise<void> {
  const { payload } = event;
  const taskId = event.taskId ?? (payload.taskId as string);
  const role = payload.role as string ?? payload.assignedTo as string;
  const engine = payload.engine as string ?? "CODEX";

  // Check for existing idle session with same role
  const existing = await db.select().from(agentSessions)
    .where(eq(agentSessions.role, role));
  const idleSession = existing.find(s => s.state === "IDLE");

  let sessionId: string;

  if (idleSession) {
    // Reuse existing session: IDLE → BOUND → RUNNING
    sessionId = idleSession.id;
    assertTransition(SESSION_TRANSITIONS, "IDLE", "BOUND");
    await db.update(agentSessions).set({
      state: "BOUND",
      lastHeartbeat: new Date(),
      metadata: { ...(idleSession.metadata as Record<string, unknown> || {}), taskId },
    }).where(eq(agentSessions.id, sessionId));

    assertTransition(SESSION_TRANSITIONS, "BOUND", "RUNNING");
    await db.update(agentSessions).set({
      state: "RUNNING",
      lastHeartbeat: new Date(),
    }).where(eq(agentSessions.id, sessionId));

    console.log(`[runtime-manager] Reused session ${sessionId} for ${role} (IDLE→BOUND→RUNNING)`);
  } else {
    // Create new session (starts as IDLE, then BOUND → RUNNING)
    const [session] = await db.insert(agentSessions).values({
      workspaceId: event.workspaceId ?? WORKSPACE_ID,
      role,
      engine,
      state: "IDLE",
      lastHeartbeat: new Date(),
      metadata: { taskId },
    }).returning();
    sessionId = session.id;

    // IDLE → BOUND → RUNNING
    assertTransition(SESSION_TRANSITIONS, "IDLE", "BOUND");
    await db.update(agentSessions).set({ state: "BOUND" }).where(eq(agentSessions.id, sessionId));

    assertTransition(SESSION_TRANSITIONS, "BOUND", "RUNNING");
    await db.update(agentSessions).set({ state: "RUNNING" }).where(eq(agentSessions.id, sessionId));

    console.log(`[runtime-manager] Created session ${sessionId} for ${role} (IDLE→BOUND→RUNNING)`);
  }

  // Grant capability lease for the session
  const DEFAULT_LEASE_DURATION_MS = 600_000; // 10 minutes
  const capabilities = inferCapabilities(role);
  for (const cap of capabilities) {
    await db.insert(capabilityLeases).values({
      sessionId,
      capability: cap,
      grantedAt: new Date(),
      expiresAt: new Date(Date.now() + DEFAULT_LEASE_DURATION_MS),
    });
  }
  console.log(`[runtime-manager] Granted ${capabilities.length} capability leases to session ${sessionId}`);

  // Publish session.created event
  await eventBus.publish(createEvent("session.created", {
    agentId: role,
    paneId: undefined,
  }, {
    sessionId,
    taskId,
    workspaceId: event.workspaceId ?? WORKSPACE_ID,
    actor: { kind: "system", id: "runtime-manager" },
  }));
}

/** Infer capabilities from role */
function inferCapabilities(role: string): string[] {
  const ROLE_CAPS: Record<string, string[]> = {
    BUILDER: ["READ_CONTEXT", "WRITE_WORKSPACE", "EXEC_SHELL"],
    ARCHITECT: ["READ_CONTEXT", "WRITE_WORKSPACE"],
    PM: ["READ_CONTEXT"],
    OPERATIONS_REVIEWER: ["READ_CONTEXT", "EXEC_SHELL"],
    STRATEGIST: ["READ_CONTEXT"],
    RESEARCH_ANALYST: ["READ_CONTEXT", "BROWSER_ACT"],
    REVIEWER: ["READ_CONTEXT"],
  };
  return ROLE_CAPS[role] ?? ["READ_CONTEXT"];
}

async function handleTaskCompleted(event: EventEnvelope): Promise<void> {
  const taskId = event.taskId ?? (event.payload.taskId as string);

  // Find session for this task
  const sessions = await db.select().from(agentSessions);
  const session = sessions.find(s => {
    const meta = s.metadata as Record<string, unknown> | null;
    return meta?.taskId === taskId && s.state === "RUNNING";
  });

  if (session) {
    // RUNNING → IDLE (ready for reuse)
    if (canTransition(SESSION_TRANSITIONS, session.state as "RUNNING", "IDLE")) {
      assertTransition(SESSION_TRANSITIONS, session.state as "RUNNING", "IDLE");
      await db.update(agentSessions).set({
        state: "IDLE",
        lastHeartbeat: new Date(),
      }).where(eq(agentSessions.id, session.id));
      console.log(`[runtime-manager] Session ${session.id} RUNNING→IDLE (task ${taskId} done)`);

      await eventBus.publish(createEvent("session.closed", {
        reason: "task_completed",
        totalUptimeMs: Date.now() - new Date(session.createdAt).getTime(),
      }, {
        sessionId: session.id,
        taskId,
        actor: { kind: "system", id: "runtime-manager" },
      }));
    }
  }
}

export { eventBus };
