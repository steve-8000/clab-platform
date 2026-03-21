import { db } from "./app.js";
import * as schema from "@clab/db";
import { eq } from "drizzle-orm";
import {
  SESSION_TRANSITIONS,
  assertTransition,
  canTransition,
} from "@clab/domain";

const { agentSessions } = schema;

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const STALE_THRESHOLD_MS = 120_000; // 2 minutes
const LOST_THRESHOLD_MS = 300_000; // 5 minutes

export function startHeartbeatMonitor(): void {
  console.log("[heartbeat] Monitor started (interval: 30s, stale: 2min, lost: 5min)");

  setInterval(async () => {
    try {
      const sessions = await db.select().from(agentSessions);
      const runningSessions = sessions.filter(s =>
        s.state === "RUNNING" || s.state === "AWAITING_INPUT"
      );

      for (const session of runningSessions) {
        const lastBeat = session.lastHeartbeat
          ? new Date(session.lastHeartbeat).getTime()
          : new Date(session.createdAt).getTime();

        const staleDuration = Date.now() - lastBeat;

        if (staleDuration > STALE_THRESHOLD_MS) {
          const currentState = session.state as "RUNNING" | "AWAITING_INPUT";
          if (canTransition(SESSION_TRANSITIONS, currentState, "STALE")) {
            assertTransition(SESSION_TRANSITIONS, currentState, "STALE");
            console.warn(`[heartbeat] Session ${session.id} (${session.role}) ${currentState}→STALE — ${Math.round(staleDuration / 1000)}s without heartbeat`);

            await db.update(agentSessions).set({
              state: "STALE",
              metadata: {
                ...(session.metadata as Record<string, unknown> || {}),
                staleDetectedAt: new Date().toISOString(),
                staleDurationMs: staleDuration,
              },
            }).where(eq(agentSessions.id, session.id));
          }
        }
      }

      // STALE → LOST after 5 minutes
      const staleSessions = sessions.filter(s => s.state === "STALE");
      for (const session of staleSessions) {
        const meta = session.metadata as Record<string, unknown> | null;
        const staleAt = meta?.staleDetectedAt
          ? new Date(meta.staleDetectedAt as string).getTime()
          : Date.now();
        const staleFor = Date.now() - staleAt;

        if (staleFor > LOST_THRESHOLD_MS) {
          if (canTransition(SESSION_TRANSITIONS, "STALE", "LOST")) {
            assertTransition(SESSION_TRANSITIONS, "STALE", "LOST");
            console.warn(`[heartbeat] Session ${session.id} STALE→LOST (${Math.round(staleFor / 1000)}s)`);

            await db.update(agentSessions).set({
              state: "LOST",
              metadata: {
                ...(meta || {}),
                lostDetectedAt: new Date().toISOString(),
              },
            }).where(eq(agentSessions.id, session.id));

            // LOST → CLOSED (auto-cleanup)
            assertTransition(SESSION_TRANSITIONS, "LOST", "CLOSED");
            await db.update(agentSessions).set({
              state: "CLOSED",
              closedAt: new Date(),
            }).where(eq(agentSessions.id, session.id));

            console.warn(`[heartbeat] Session ${session.id} LOST→CLOSED (auto-cleanup)`);
          }
        }
      }

      // Stats
      const active = sessions.filter(s => s.state === "RUNNING").length;
      const idle = sessions.filter(s => s.state === "IDLE").length;
      const stale = sessions.filter(s => s.state === "STALE").length;
      const lost = sessions.filter(s => s.state === "LOST").length;
      if (active > 0 || stale > 0 || lost > 0) {
        console.log(`[heartbeat] Sessions: ${active} running, ${idle} idle, ${stale} stale, ${lost} lost`);
      }
    } catch (err) {
      console.error("[heartbeat] Monitor error:", err);
    }
  }, HEARTBEAT_INTERVAL_MS);
}
