import { db } from "./app.js";
import * as schema from "@clab/db";
import { eq } from "drizzle-orm";

const { agentSessions } = schema;

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const STALE_THRESHOLD_MS = 120_000; // 2 minutes

export function startHeartbeatMonitor(): void {
  console.log("[heartbeat] Monitor started (interval: 30s, stale: 2min)");

  setInterval(async () => {
    try {
      const sessions = await db.select().from(agentSessions);
      const runningSessions = sessions.filter(s => s.state === "RUNNING");

      for (const session of runningSessions) {
        const lastBeat = session.lastHeartbeat
          ? new Date(session.lastHeartbeat).getTime()
          : new Date(session.createdAt).getTime();

        const staleDuration = Date.now() - lastBeat;

        if (staleDuration > STALE_THRESHOLD_MS) {
          console.warn(`[heartbeat] Session ${session.id} (${session.role}) STALE — ${Math.round(staleDuration / 1000)}s without heartbeat`);

          // Mark as stale
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

      // Recovery: close sessions that have been stale for too long (5 min)
      const staleSessions = sessions.filter(s => s.state === "STALE");
      for (const session of staleSessions) {
        const meta = session.metadata as Record<string, unknown> | null;
        const staleAt = meta?.staleDetectedAt
          ? new Date(meta.staleDetectedAt as string).getTime()
          : Date.now();
        const staleFor = Date.now() - staleAt;

        if (staleFor > 300_000) { // 5 minutes stale → close
          console.warn(`[heartbeat] Session ${session.id} stale for ${Math.round(staleFor / 1000)}s — closing`);
          await db.update(agentSessions).set({
            state: "CLOSED",
            closedAt: new Date(),
          }).where(eq(agentSessions.id, session.id));
        }
      }

      // Stats
      const active = sessions.filter(s => s.state === "RUNNING").length;
      const idle = sessions.filter(s => s.state === "IDLE").length;
      const stale = sessions.filter(s => s.state === "STALE").length;
      if (active > 0 || stale > 0) {
        console.log(`[heartbeat] Sessions: ${active} running, ${idle} idle, ${stale} stale`);
      }
    } catch (err) {
      console.error("[heartbeat] Monitor error:", err);
    }
  }, HEARTBEAT_INTERVAL_MS);
}
