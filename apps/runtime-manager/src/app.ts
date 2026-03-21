import { Hono } from "hono";
import { cors } from "hono/cors";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@clab/db";
import { eq, and, isNull } from "drizzle-orm";

const { agentSessions, capabilityLeases } = schema;
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://clab:clab-stg-pass@postgres:5432/clab";
const sql = postgres(DATABASE_URL);
export const db = drizzle(sql, { schema });

export const app = new Hono()
  .use("*", cors())
  .get("/health", (c) => c.json({ status: "ok", service: "runtime-manager" }))

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

  // POST /sessions/:id/heartbeat — worker reports heartbeat
  .post("/sessions/:id/heartbeat", async (c) => {
    const id = c.req.param("id");
    const [session] = await db.select().from(agentSessions).where(eq(agentSessions.id, id));
    if (!session) return c.json({ error: "Session not found" }, 404);

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;

    await db.update(agentSessions).set({
      lastHeartbeat: new Date(),
      state: session.state === "STALE" ? "RUNNING" : session.state,
      metadata: {
        ...(session.metadata as Record<string, unknown> || {}),
        ...(body.memoryUsageMb ? { memoryUsageMb: body.memoryUsageMb } : {}),
        ...(body.outputHash ? { outputHash: body.outputHash } : {}),
      },
    }).where(eq(agentSessions.id, id));

    return c.json({ status: "ok", sessionId: id, heartbeatAt: new Date().toISOString() });
  })

  // POST /sessions/:id/close — close a session
  .post("/sessions/:id/close", async (c) => {
    const id = c.req.param("id");
    await db.update(agentSessions).set({
      state: "CLOSED",
      closedAt: new Date(),
    }).where(eq(agentSessions.id, id));
    return c.json({ status: "closed", sessionId: id });
  })

  // GET /leases — list active (non-revoked, non-expired) leases
  .get("/leases", async (c) => {
    const leases = await db.select().from(capabilityLeases)
      .where(isNull(capabilityLeases.revokedAt));
    const now = new Date();
    const active = leases.filter(l => new Date(l.expiresAt) > now);
    return c.json(active);
  })

  // GET /leases/:sessionId — leases for a specific session
  .get("/leases/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const leases = await db.select().from(capabilityLeases)
      .where(and(eq(capabilityLeases.sessionId, sessionId), isNull(capabilityLeases.revokedAt)));
    return c.json(leases);
  })

  // POST /leases/:id/renew — renew a capability lease
  .post("/leases/:id/renew", async (c) => {
    const id = c.req.param("id");
    const [lease] = await db.select().from(capabilityLeases).where(eq(capabilityLeases.id, id));
    if (!lease) return c.json({ error: "Lease not found" }, 404);
    if (lease.revokedAt) return c.json({ error: "Lease already revoked" }, 409);

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const durationMs = (body.durationMs as number) || 600_000; // default 10 min
    const maxRenewals = 3;

    const meta = (lease as unknown as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
    const renewalCount = (meta?.renewalCount as number) || 0;
    if (renewalCount >= maxRenewals) {
      return c.json({ error: "Max renewals exceeded", renewalCount, maxRenewals }, 409);
    }

    const newExpiry = new Date(Date.now() + durationMs);
    await db.update(capabilityLeases).set({
      expiresAt: newExpiry,
    }).where(eq(capabilityLeases.id, id));

    return c.json({
      status: "renewed",
      leaseId: id,
      expiresAt: newExpiry.toISOString(),
      renewalCount: renewalCount + 1,
    });
  })

  // POST /leases/:id/revoke — revoke a capability lease
  .post("/leases/:id/revoke", async (c) => {
    const id = c.req.param("id");
    await db.update(capabilityLeases).set({
      revokedAt: new Date(),
    }).where(eq(capabilityLeases.id, id));
    return c.json({ status: "revoked", leaseId: id });
  });
