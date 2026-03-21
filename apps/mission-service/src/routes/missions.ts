import { Hono } from "hono";
import { db, logger, publishEvent } from "../deps.js";
import { missions, plans, waves, tasks } from "@clab/db";
import { eq } from "drizzle-orm";

export const missionRoutes = new Hono();

// POST / — Create mission + auto-plan
missionRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const { title, objective, workspaceId } = body;

  if (!title || !objective || !workspaceId) {
    return c.json({ error: "title, objective, workspaceId required" }, 400);
  }

  // 1. Create mission
  const [mission] = await db.insert(missions).values({
    workspaceId,
    title,
    objective,
    status: "DRAFT",
    priority: body.priority || "NORMAL",
  }).returning();

  logger.info("Mission created", { missionId: mission.id });

  // 2. Auto-plan: create plan + 1 wave + 1 task
  const [plan] = await db.insert(plans).values({
    missionId: mission.id,
    summary: `Plan for: ${title}`,
    waveCount: 1,
  }).returning();

  const [wave] = await db.insert(waves).values({
    planId: plan.id,
    missionId: mission.id,
    ordinal: 1,
    label: "Wave 1",
    status: "PENDING",
    directive: objective,
  }).returning();

  const [task] = await db.insert(tasks).values({
    waveId: wave.id,
    missionId: mission.id,
    title: title,
    description: objective,
    role: body.role || "BUILDER",
    engine: body.engine || "CODEX",
    status: "QUEUED",
  }).returning();

  // 3. Update mission to PLANNED
  await db.update(missions).set({ status: "PLANNED", updatedAt: new Date() }).where(eq(missions.id, mission.id));

  logger.info("Mission planned", { missionId: mission.id, planId: plan.id, waveId: wave.id, taskId: task.id });

  return c.json({
    mission: { ...mission, status: "PLANNED" },
    plan,
    wave,
    task,
  }, 201);
});

// POST /:id/start — Start mission (queue tasks)
missionRoutes.post("/:id/start", async (c) => {
  const id = c.req.param("id");

  // Update mission to RUNNING
  await db.update(missions).set({ status: "RUNNING", updatedAt: new Date() }).where(eq(missions.id, id));

  // Update wave to RUNNING
  const missionWaves = await db.select().from(waves).where(eq(waves.missionId, id));
  for (const wave of missionWaves) {
    await db.update(waves).set({ status: "RUNNING", startedAt: new Date() }).where(eq(waves.id, wave.id));
  }

  // Update tasks to ASSIGNED
  const missionTasks = await db.select().from(tasks).where(eq(tasks.missionId, id));
  for (const task of missionTasks) {
    await db.update(tasks).set({ status: "ASSIGNED", updatedAt: new Date() }).where(eq(tasks.id, task.id));
  }

    // Emit events for each assigned task
    for (const task of missionTasks) {
      await publishEvent("clab.task.assigned", {
        taskId: task.id,
        missionId: id,
        waveId: task.waveId,
        role: task.role,
        engine: task.engine,
        title: task.title,
        description: task.description,
      });
    }

  logger.info("Mission started", { missionId: id, tasks: missionTasks.length });

  return c.json({ status: "RUNNING", tasksAssigned: missionTasks.length });
});

// GET /:id — Get mission with all related data
missionRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const [mission] = await db.select().from(missions).where(eq(missions.id, id));
  if (!mission) return c.json({ error: "Mission not found" }, 404);

  const missionPlans = await db.select().from(plans).where(eq(plans.missionId, id));
  const missionWaves = await db.select().from(waves).where(eq(waves.missionId, id));
  const missionTasks = await db.select().from(tasks).where(eq(tasks.missionId, id));

  return c.json({ mission, plans: missionPlans, waves: missionWaves, tasks: missionTasks });
});

// GET / — List all missions
missionRoutes.get("/", async (c) => {
  const allMissions = await db.select().from(missions);
  return c.json(allMissions);
});
