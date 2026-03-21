import { Hono } from "hono";
import { cors } from "hono/cors";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@clab/db";
import { eq } from "drizzle-orm";

const { agentSessions, taskRuns } = schema;
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://clab:clab-stg-pass@postgres:5432/clab";
export const sql = postgres(DATABASE_URL);
export const db = drizzle(sql, { schema });

import { isHeartbeatRunning } from "./heartbeat.js";
import { getNatsConnection } from "./session-manager.js";

export const app = new Hono()
  .use("*", cors())
  .get("/health", async (c) => {
    const checks: Record<string, string> = {};

    // Check DB connectivity
    try {
      await sql`SELECT 1`;
      checks.db = "ok";
    } catch {
      checks.db = "error";
    }

    // Check NATS/EventBus connection
    const natsConn = getNatsConnection();
    checks.nats = natsConn && !natsConn.isClosed() ? "ok" : "disconnected";

    // Check heartbeat monitor status
    checks.heartbeat = isHeartbeatRunning() ? "ok" : "stopped";

    const allOk = Object.values(checks).every(v => v === "ok");
    const status = allOk ? "ok" : "degraded";

    return c.json({ status, service: "runtime-manager", checks }, allOk ? 200 : 503);
  })

  // GET /sessions — list all sessions
  .get("/sessions", async (c) => {
    const sessions = await db.select().from(agentSessions);
    return c.json(sessions);
  })

  // GET /sessions/active — list active sessions
  .get("/sessions/active", async (c) => {
    const active = await db.select().from(agentSessions)
      .where(eq(agentSessions.state, "RUNNING"));
    return c.json(active);
  })

  // GET /sessions/:id — get session details
  .get("/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const [session] = await db.select().from(agentSessions).where(eq(agentSessions.id, id));
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json(session);
  })

  // POST /sessions/:id/close — close a session
  .post("/sessions/:id/close", async (c) => {
    const id = c.req.param("id");
    await db.update(agentSessions).set({
      state: "CLOSED",
      closedAt: new Date(),
    }).where(eq(agentSessions.id, id));
    return c.json({ status: "closed", sessionId: id });
  });
