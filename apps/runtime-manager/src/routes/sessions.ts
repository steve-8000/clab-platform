import { Hono } from "hono";
import { createDb } from "@clab/db";
import { CmuxSocketClient } from "@clab/cmux-adapter";
import { EventBus } from "@clab/events";
import { SessionManager } from "../services/session-manager.js";

const db = createDb();
const cmux = new CmuxSocketClient();
const bus = new EventBus();
const sessionManager = new SessionManager(db, cmux, bus);

// Initialize connections lazily
let initialized = false;
async function ensureInit(): Promise<void> {
  if (initialized) return;
  await cmux.connect();
  await bus.connect();
  initialized = true;
}

const sessions = new Hono();

// ---------------------------------------------------------------------------
// GET / — list all sessions
// ---------------------------------------------------------------------------
sessions.get("/", async (c) => {
  await ensureInit();
  const stateFilter = c.req.query("state");
  const list = await sessionManager.list(stateFilter);
  return c.json({ ok: true, sessions: list });
});

// ---------------------------------------------------------------------------
// POST / — create session (ensure role surface via cmux adapter)
// ---------------------------------------------------------------------------
sessions.post("/", async (c) => {
  await ensureInit();
  const body = await c.req.json<{
    workspaceId: string;
    role: string;
    engine: "CODEX" | "CLAUDE" | "BROWSER";
    preferredPaneId?: string;
  }>();

  if (!body.workspaceId || !body.role || !body.engine) {
    return c.json({ ok: false, error: "workspaceId, role, and engine are required" }, 400);
  }

  try {
    const session = await sessionManager.ensureSession({
      workspaceId: body.workspaceId,
      role: body.role,
      engine: body.engine,
      preferredPaneId: body.preferredPaneId,
    });
    return c.json({ ok: true, session }, 201);
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /:id/bind — bind session to task run
// ---------------------------------------------------------------------------
sessions.post("/:id/bind", async (c) => {
  await ensureInit();
  const { id } = c.req.param();
  const body = await c.req.json<{ taskRunId: string }>();

  if (!body.taskRunId) {
    return c.json({ ok: false, error: "taskRunId is required" }, 400);
  }

  try {
    await sessionManager.bindToTask(id, body.taskRunId);
    return c.json({ ok: true, sessionId: id, taskRunId: body.taskRunId });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 400);
  }
});

// ---------------------------------------------------------------------------
// POST /:id/rebind — rebind stale session (recover and create new)
// ---------------------------------------------------------------------------
sessions.post("/:id/rebind", async (c) => {
  await ensureInit();
  const { id } = c.req.param();

  try {
    await sessionManager.recoverStale(id);
    return c.json({ ok: true, sessionId: id, action: "rebind-recovery" });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 400);
  }
});

// ---------------------------------------------------------------------------
// POST /:id/interrupt — interrupt session
// ---------------------------------------------------------------------------
sessions.post("/:id/interrupt", async (c) => {
  await ensureInit();
  const { id } = c.req.param();

  try {
    await sessionManager.interrupt(id);
    return c.json({ ok: true, sessionId: id, action: "interrupted" });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 400);
  }
});

// ---------------------------------------------------------------------------
// POST /:id/close — close session
// ---------------------------------------------------------------------------
sessions.post("/:id/close", async (c) => {
  await ensureInit();
  const { id } = c.req.param();

  try {
    await sessionManager.close(id);
    return c.json({ ok: true, sessionId: id, action: "closed" });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 400);
  }
});

export { sessions as sessionRoutes };
