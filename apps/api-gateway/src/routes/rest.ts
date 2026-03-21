import { Hono } from "hono";
// import { ClabClient } from "@clab/sdk";

const rest = new Hono();

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

rest.post("/missions", async (c) => {
  const body = await c.req.json();
  // TODO: delegate via ClabClient → orchestrator
  return c.json({ ok: true, action: "mission.create", body }, 201);
});

rest.get("/missions/:id", async (c) => {
  const { id } = c.req.param();
  // TODO: delegate via ClabClient → orchestrator
  return c.json({ ok: true, action: "mission.get", missionId: id });
});

rest.post("/missions/:id/plan", async (c) => {
  const { id } = c.req.param();
  // TODO: delegate via ClabClient → orchestrator
  return c.json({ ok: true, action: "mission.plan", missionId: id });
});

rest.post("/missions/:id/abort", async (c) => {
  const { id } = c.req.param();
  // TODO: delegate via ClabClient → orchestrator
  return c.json({ ok: true, action: "mission.abort", missionId: id });
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

rest.post("/tasks", async (c) => {
  const body = await c.req.json();
  // TODO: delegate via ClabClient → runtime-manager
  return c.json({ ok: true, action: "task.create", body }, 201);
});

rest.post("/tasks/:id/retry", async (c) => {
  const { id } = c.req.param();
  // TODO: delegate via ClabClient → runtime-manager
  return c.json({ ok: true, action: "task.retry", taskId: id });
});

rest.post("/tasks/:id/review", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  // TODO: delegate via ClabClient → runtime-manager
  return c.json({ ok: true, action: "task.review", taskId: id, body });
});

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

rest.get("/waves/:missionId", async (c) => {
  const { missionId } = c.req.param();
  // TODO: delegate via ClabClient → orchestrator
  return c.json({ ok: true, action: "waves.list", missionId });
});

rest.post("/waves/:id/release", async (c) => {
  const { id } = c.req.param();
  // TODO: delegate via ClabClient → orchestrator
  return c.json({ ok: true, action: "wave.release", waveId: id });
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

rest.get("/sessions", async (c) => {
  // TODO: delegate via ClabClient → runtime-manager
  return c.json({ ok: true, action: "sessions.list" });
});

rest.post("/sessions/:id/rebind", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  // TODO: delegate via ClabClient → runtime-manager
  return c.json({ ok: true, action: "session.rebind", sessionId: id, body });
});

rest.post("/sessions/:id/interrupt", async (c) => {
  const { id } = c.req.param();
  // TODO: delegate via ClabClient → runtime-manager
  return c.json({ ok: true, action: "session.interrupt", sessionId: id });
});

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

rest.get("/artifacts/:missionId", async (c) => {
  const { missionId } = c.req.param();
  // TODO: delegate via ClabClient → orchestrator
  return c.json({ ok: true, action: "artifacts.list", missionId });
});

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

rest.get("/decisions/:missionId", async (c) => {
  const { missionId } = c.req.param();
  // TODO: delegate via ClabClient → orchestrator
  return c.json({ ok: true, action: "decisions.list", missionId });
});

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

rest.get("/approvals", async (c) => {
  // TODO: delegate via ClabClient → orchestrator
  return c.json({ ok: true, action: "approvals.list" });
});

rest.post("/approvals/:id/resolve", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  // TODO: delegate via ClabClient → orchestrator
  return c.json({ ok: true, action: "approval.resolve", approvalId: id, body });
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

rest.get("/dashboard", async (c) => {
  // TODO: delegate via ClabClient → orchestrator aggregate
  return c.json({ ok: true, action: "dashboard" });
});

export { rest as restRoutes };
