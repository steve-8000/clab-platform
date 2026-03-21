import { eq } from "drizzle-orm";
import type { Database } from "@clab/db";
import { agentSessions } from "@clab/db";
import { EventBus, createEvent } from "@clab/events";
import { SessionManager } from "./session-manager.js";

/**
 * Periodically scans all active sessions, performs heartbeat checks,
 * and triggers stale recovery when sessions are unresponsive.
 */
export class HeartbeatMonitor {
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private db: Database,
    private sessionManager: SessionManager,
    private bus: EventBus,
  ) {}

  /**
   * Start the heartbeat monitor loop.
   * Scans every `intervalMs` milliseconds (default 30s).
   */
  start(intervalMs: number = 30_000): void {
    if (this.interval) {
      return; // already running
    }

    console.log(`[HeartbeatMonitor] starting with interval ${intervalMs}ms`);

    this.interval = setInterval(async () => {
      try {
        await this.scan();
      } catch (err) {
        console.error("[HeartbeatMonitor] scan error:", err);
      }
    }, intervalMs);

    // Run an initial scan immediately
    this.scan().catch((err) =>
      console.error("[HeartbeatMonitor] initial scan error:", err),
    );
  }

  /**
   * Stop the heartbeat monitor loop.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log("[HeartbeatMonitor] stopped");
    }
  }

  /**
   * Perform a single scan across all active sessions.
   * Active sessions are those in BOUND, RUNNING, or STALE states.
   */
  private async scan(): Promise<void> {
    const activeSessions = await this.db
      .select()
      .from(agentSessions)
      .where(
        // We check sessions that could be in an active state
        // drizzle-orm doesn't have `in` as a direct method on the column,
        // so we query all non-closed and check in code
        eq(agentSessions.state, "RUNNING"),
      );

    const boundSessions = await this.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.state, "BOUND"));

    const staleSessions = await this.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.state, "STALE"));

    const allActive = [...activeSessions, ...boundSessions, ...staleSessions];

    if (allActive.length === 0) {
      return;
    }

    console.log(`[HeartbeatMonitor] scanning ${allActive.length} active session(s)`);

    let healthyCount = 0;
    let staleCount = 0;
    let recoveredCount = 0;

    for (const session of allActive) {
      try {
        // For STALE sessions, attempt recovery
        if (session.state === "STALE") {
          console.log(`[HeartbeatMonitor] recovering stale session ${session.id}`);
          await this.sessionManager.recoverStale(session.id);
          recoveredCount++;
          continue;
        }

        // For RUNNING/BOUND sessions, perform heartbeat check
        const result = await this.sessionManager.heartbeat(session.id);
        if (result.healthy) {
          healthyCount++;
        } else {
          staleCount++;
        }

        // Check lease expiration for BOUND sessions
        if (session.state === "BOUND") {
          const meta = session.metadata as Record<string, unknown> | null;
          const leaseExpires = meta?.leaseExpiresAt as string | undefined;
          if (leaseExpires && new Date(leaseExpires).getTime() < Date.now()) {
            console.log(`[HeartbeatMonitor] session ${session.id} lease expired`);
            await this.bus.publish(
              createEvent("session.stale.detected", {
                sessionId: session.id,
                reason: "lease-expired",
                leaseExpiresAt: leaseExpires,
              }, { sessionId: session.id }),
            );

            // Mark as STALE so it gets recovered on next scan
            await this.db
              .update(agentSessions)
              .set({ state: "STALE" })
              .where(eq(agentSessions.id, session.id));
          }
        }
      } catch (err) {
        console.error(`[HeartbeatMonitor] error checking session ${session.id}:`, err);

        // If heartbeat fails entirely, mark session as LOST
        try {
          await this.db
            .update(agentSessions)
            .set({ state: "LOST" })
            .where(eq(agentSessions.id, session.id));

          await this.bus.publish(
            createEvent("session.lost", {
              sessionId: session.id,
              error: String(err),
            }, { sessionId: session.id }),
          );
        } catch (innerErr) {
          console.error(`[HeartbeatMonitor] failed to mark session ${session.id} as LOST:`, innerErr);
        }
      }
    }

    console.log(
      `[HeartbeatMonitor] scan complete: ${healthyCount} healthy, ${staleCount} stale, ${recoveredCount} recovered`,
    );
  }
}
