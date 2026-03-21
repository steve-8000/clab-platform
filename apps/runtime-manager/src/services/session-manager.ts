import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { Database } from "@clab/db";
import { agentSessions, taskRuns } from "@clab/db";
import type { CmuxAdapter } from "@clab/cmux-adapter";
import type { AgentSession, Engine } from "@clab/domain";
import { assertTransition, SESSION_TRANSITIONS } from "@clab/domain";
import { EventBus, createEvent } from "@clab/events";

const LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes with no output change

export class SessionManager {
  constructor(
    private db: Database,
    private cmux: CmuxAdapter,
    private bus: EventBus,
  ) {}

  /**
   * Ensure a session exists for the given role and engine.
   * Reuses an existing IDLE session if available; otherwise creates a new one.
   */
  async ensureSession(input: {
    workspaceId: string;
    role: string;
    engine: Engine;
    preferredPaneId?: string;
  }): Promise<AgentSession> {
    // Check for existing IDLE session with same role and engine
    const existing = await this.db
      .select()
      .from(agentSessions)
      .where(
        and(
          eq(agentSessions.workspaceId, input.workspaceId),
          eq(agentSessions.role, input.role),
          eq(agentSessions.engine, input.engine),
          eq(agentSessions.state, "IDLE"),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0]!;
      return this.rowToSession(row);
    }

    // Create a new pane via cmux adapter
    const pane = input.preferredPaneId
      ? { id: input.preferredPaneId }
      : await this.cmux.paneSplit("right");

    const id = randomUUID();
    const now = new Date().toISOString();

    const [inserted] = await this.db
      .insert(agentSessions)
      .values({
        id,
        workspaceId: input.workspaceId,
        role: input.role,
        engine: input.engine,
        state: "IDLE",
        paneId: pane.id,
        lastHeartbeat: new Date(),
        metadata: {},
      })
      .returning();

    const session = this.rowToSession(inserted!);

    await this.bus.publish(
      createEvent("session.created", {
        sessionId: id,
        role: input.role,
        engine: input.engine,
        paneId: pane.id,
      }, {
        sessionId: id,
        workspaceId: input.workspaceId,
      }),
    );

    return session;
  }

  /**
   * Transition session from IDLE to BOUND when assigned to a task run.
   * Sets the lease expiration for session timeout tracking.
   */
  async bindToTask(sessionId: string, taskRunId: string): Promise<void> {
    const [session] = await this.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    assertTransition(
      SESSION_TRANSITIONS,
      session.state as AgentSession["state"],
      "BOUND",
    );

    const leaseExpiresAt = new Date(Date.now() + LEASE_DURATION_MS);

    await this.db
      .update(agentSessions)
      .set({ state: "BOUND", metadata: { ...session.metadata, leaseExpiresAt: leaseExpiresAt.toISOString(), taskRunId } })
      .where(eq(agentSessions.id, sessionId));

    // Link task run to session
    await this.db
      .update(taskRuns)
      .set({ sessionId })
      .where(eq(taskRuns.id, taskRunId));

    await this.bus.publish(
      createEvent("session.bound", {
        sessionId,
        taskRunId,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
      }, {
        sessionId,
        taskRunId,
      }),
    );
  }

  /**
   * Perform a heartbeat check on a session.
   * Reads pane output via cmux, updates the lastHeartbeat timestamp,
   * and checks for staleness (no output change > 2 minutes).
   */
  async heartbeat(sessionId: string): Promise<{ healthy: boolean }> {
    const [session] = await this.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);

    if (!session || !session.paneId) {
      return { healthy: false };
    }

    const now = new Date();
    let output: string;
    try {
      output = await this.cmux.readText(session.paneId);
    } catch {
      // Pane is unreachable — mark as unhealthy
      return { healthy: false };
    }

    const previousOutput = (session.metadata as Record<string, unknown>)?.lastOutput as string | undefined;
    const lastOutputChange = (session.metadata as Record<string, unknown>)?.lastOutputChangeAt as string | undefined;
    const outputChanged = output !== previousOutput;

    const lastChangeAt = outputChanged
      ? now.toISOString()
      : lastOutputChange ?? now.toISOString();

    // Check staleness: no output change for longer than threshold
    const timeSinceChange = now.getTime() - new Date(lastChangeAt).getTime();
    const isStale = timeSinceChange > STALE_THRESHOLD_MS && session.state === "RUNNING";

    await this.db
      .update(agentSessions)
      .set({
        lastHeartbeat: now,
        metadata: {
          ...session.metadata as Record<string, unknown>,
          lastOutput: output,
          lastOutputChangeAt: lastChangeAt,
        },
      })
      .where(eq(agentSessions.id, sessionId));

    await this.bus.publish(
      createEvent("session.heartbeat", {
        sessionId,
        healthy: !isStale,
        paneId: session.paneId,
        outputLength: output.length,
        timeSinceChangeMs: timeSinceChange,
      }, { sessionId }),
    );

    if (isStale) {
      // Transition to STALE state
      try {
        assertTransition(
          SESSION_TRANSITIONS,
          session.state as AgentSession["state"],
          "STALE",
        );
        await this.db
          .update(agentSessions)
          .set({ state: "STALE" })
          .where(eq(agentSessions.id, sessionId));

        await this.bus.publish(
          createEvent("session.stale.detected", {
            sessionId,
            timeSinceChangeMs: timeSinceChange,
            paneId: session.paneId,
          }, { sessionId }),
        );
      } catch {
        // Transition not allowed from current state; ignore
      }
    }

    return { healthy: !isStale };
  }

  /**
   * Recover a stale session:
   * 1. Capture final pane output
   * 2. Soft interrupt the agent
   * 3. Create a new replacement session
   * 4. Rebind the task run to the new session
   */
  async recoverStale(sessionId: string): Promise<void> {
    const [session] = await this.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Capture pane output before interrupting
    let capturedOutput = "";
    if (session.paneId) {
      try {
        capturedOutput = await this.cmux.readText(session.paneId);
      } catch {
        // Pane may already be gone
      }

      // Soft interrupt
      try {
        await this.cmux.sendKey(session.paneId, "C-c");
      } catch {
        // Best effort
      }
    }

    // Close the stale session
    await this.db
      .update(agentSessions)
      .set({
        state: "CLOSED",
        closedAt: new Date(),
        metadata: {
          ...session.metadata as Record<string, unknown>,
          closureReason: "stale-recovery",
          capturedOutput,
        },
      })
      .where(eq(agentSessions.id, sessionId));

    // Find the bound task run
    const taskRunId = (session.metadata as Record<string, unknown>)?.taskRunId as string | undefined;
    if (!taskRunId) {
      await this.bus.publish(
        createEvent("session.closed", {
          sessionId,
          reason: "stale-recovery",
        }, { sessionId }),
      );
      return;
    }

    // Create a replacement session
    const newSession = await this.ensureSession({
      workspaceId: session.workspaceId,
      role: session.role,
      engine: session.engine as Engine,
    });

    // Rebind the task run to the new session
    await this.bindToTask(newSession.id, taskRunId);

    await this.bus.publish(
      createEvent("session.recovered", {
        oldSessionId: sessionId,
        newSessionId: newSession.id,
        taskRunId,
        capturedOutputLength: capturedOutput.length,
      }, {
        sessionId: newSession.id,
        taskRunId,
      }),
    );
  }

  /**
   * Interrupt a running session by sending Ctrl-C to the pane.
   */
  async interrupt(sessionId: string): Promise<void> {
    const [session] = await this.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.paneId) {
      await this.cmux.sendKey(session.paneId, "C-c");
    }

    // Transition back to IDLE if currently RUNNING or BOUND
    const currentState = session.state as AgentSession["state"];
    if (currentState === "RUNNING" || currentState === "BOUND") {
      await this.db
        .update(agentSessions)
        .set({ state: "IDLE" })
        .where(eq(agentSessions.id, sessionId));
    }
  }

  /**
   * Close a session, cleaning up the pane.
   */
  async close(sessionId: string): Promise<void> {
    const [session] = await this.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Close the pane if it exists
    if (session.paneId) {
      try {
        await this.cmux.paneClose(session.paneId);
      } catch {
        // Pane may already be closed
      }
    }

    await this.db
      .update(agentSessions)
      .set({ state: "CLOSED", closedAt: new Date() })
      .where(eq(agentSessions.id, sessionId));

    await this.bus.publish(
      createEvent("session.closed", {
        sessionId,
        reason: "manual-close",
      }, { sessionId }),
    );
  }

  /**
   * List all sessions, optionally filtered by state.
   */
  async list(stateFilter?: string): Promise<AgentSession[]> {
    const query = stateFilter
      ? this.db.select().from(agentSessions).where(eq(agentSessions.state, stateFilter))
      : this.db.select().from(agentSessions);

    const rows = await query;
    return rows.map((r) => this.rowToSession(r));
  }

  private rowToSession(row: typeof agentSessions.$inferSelect): AgentSession {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      role: row.role as AgentSession["role"],
      engine: row.engine as AgentSession["engine"],
      paneId: row.paneId ?? undefined,
      runtimeNode: undefined,
      workingDir: (meta.workingDir as string) ?? process.cwd(),
      branchName: (meta.branchName as string) ?? undefined,
      state: row.state as AgentSession["state"],
      leaseExpiresAt: (meta.leaseExpiresAt as string) ?? undefined,
      lastHeartbeatAt: row.lastHeartbeat?.toISOString() ?? undefined,
    };
  }
}
