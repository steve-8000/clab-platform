import { Hono } from "hono";
import { db, logger, publishEvent } from "../deps.js";
import { missions, plans, waves, tasks } from "@clab/db";
import { eq } from "drizzle-orm";
import {
  MISSION_TRANSITIONS,
  WAVE_TRANSITIONS,
  TASK_TRANSITIONS,
  assertTransition,
} from "@clab/domain";
import { PolicyEngine } from "@clab/policy";

const policyEngine = new PolicyEngine();

export const missionRoutes = new Hono();

// --- Helper functions for multi-wave planning with role routing ---

function routeRole(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(test|spec|coverage|unit test|e2e)\b/.test(lower)) return "BUILDER";
  if (/\b(design|architect|structure|interface|schema)\b/.test(lower)) return "ARCHITECT";
  if (/\b(research|analyze|investigate|study|compare)\b/.test(lower)) return "RESEARCH_ANALYST";
  if (/\b(review|verify|qa|check|audit)\b/.test(lower)) return "REVIEWER";
  if (/\b(plan|decompose|prioritize|breakdown|roadmap)\b/.test(lower)) return "PM";
  return "BUILDER";
}

function routeEngine(role: string): string {
  return role === "REVIEWER" || role === "PM" ? "CLAUDE" : "CODEX";
}

interface TaskSpec {
  title: string;
  description: string;
  role: string;
  engine: string;
}

function decomposeObjective(objective: string, defaultRole: string, defaultEngine: string): TaskSpec[] {
  const specs: TaskSpec[] = [];

  // Split by "and" or numbered items or semicolons
  const parts = objective
    .split(/(?:\band\b|;|\d+\.\s)/)
    .map(p => p.trim())
    .filter(p => p.length > 10);

  if (parts.length > 1) {
    for (const part of parts) {
      const role = routeRole(part) || defaultRole;
      specs.push({
        title: part.length > 60 ? part.slice(0, 57) + "..." : part,
        description: part,
        role,
        engine: routeEngine(role),
      });
    }
  } else {
    specs.push({
      title: objective.length > 60 ? objective.slice(0, 57) + "..." : objective,
      description: objective,
      role: defaultRole,
      engine: defaultEngine,
    });
  }

  return specs;
}

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

  // 2. Smart planning: analyze objective for multi-wave/multi-task
  const role = body.role || routeRole(objective);
  const engine = body.engine || routeEngine(role);

  const taskSpecs = decomposeObjective(objective, role, engine);
  const waveCount = taskSpecs.length > 3 ? 2 : 1; // Split into 2 waves if >3 tasks

  const [plan] = await db.insert(plans).values({
    missionId: mission.id,
    summary: `Plan for: ${title} (${taskSpecs.length} tasks, ${waveCount} waves)`,
    waveCount,
  }).returning();

  const allTasks = [];
  const allWaves = [];

  const tasksPerWave = Math.ceil(taskSpecs.length / waveCount);

  for (let w = 0; w < waveCount; w++) {
    const [wave] = await db.insert(waves).values({
      planId: plan.id,
      missionId: mission.id,
      ordinal: w + 1,
      label: `Wave ${w + 1}`,
      status: "PENDING",
      directive: w === 0 ? objective : `Continue: ${objective}`,
    }).returning();
    allWaves.push(wave);

    const waveTasks = taskSpecs.slice(w * tasksPerWave, (w + 1) * tasksPerWave);
    for (const spec of waveTasks) {
      // Pre-K enrichment
      let enrichedDesc = spec.description;
      try {
        const KNOWLEDGE_URL = process.env.KNOWLEDGE_SERVICE_URL || "http://knowledge-service:4007";
        const preKRes = await fetch(`${KNOWLEDGE_URL}/v1/pre-k/retrieve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task: spec.description, roleId: spec.role }),
        });
        if (preKRes.ok) {
          const preK = await preKRes.json() as any;
          if (preK.relatedDocs?.length > 0) {
            const context = preK.relatedDocs.map((d: any) => `[${d.path}]: ${d.excerpt}`).join("\n");
            enrichedDesc = `${spec.description}\n\n## Prior Knowledge\n${context}`;
          }
        }
      } catch {}

      const [task] = await db.insert(tasks).values({
        waveId: wave.id,
        missionId: mission.id,
        title: spec.title,
        description: enrichedDesc,
        role: spec.role,
        engine: spec.engine,
        status: "QUEUED",
      }).returning();
      allTasks.push(task);
    }
  }

  // 3. State machine: DRAFT → PLANNED
  assertTransition(MISSION_TRANSITIONS, "DRAFT", "PLANNED");
  await db.update(missions).set({ status: "PLANNED", updatedAt: new Date() }).where(eq(missions.id, mission.id));

  // 4. Publish mission.planned event
  await publishEvent("mission.planned", {
    waveCount: allWaves.length,
    taskCount: allTasks.length,
    planSummary: `${title} (${allTasks.length} tasks, ${allWaves.length} waves)`,
  }, { missionId: mission.id, workspaceId: workspaceId });

  logger.info("Mission planned", {
    missionId: mission.id,
    planId: plan.id,
    waves: allWaves.length,
    tasks: allTasks.length,
  });

  return c.json({
    mission: { ...mission, status: "PLANNED" },
    plan,
    waves: allWaves,
    tasks: allTasks,
  }, 201);
});

// POST /:id/start — Start mission (queue tasks)
missionRoutes.post("/:id/start", async (c) => {
  const id = c.req.param("id");

  // 1. Load mission and validate state transition
  const [missionData] = await db.select().from(missions).where(eq(missions.id, id));
  if (!missionData) return c.json({ error: "Mission not found" }, 404);

  assertTransition(MISSION_TRANSITIONS, missionData.status as "PLANNED", "RUNNING");
  await db.update(missions).set({ status: "RUNNING", updatedAt: new Date() }).where(eq(missions.id, id));

  // 2. Start first wave only (subsequent waves triggered by wave completion)
  const missionWaves = await db.select().from(waves).where(eq(waves.missionId, id));
  const sortedWaves = missionWaves.sort((a, b) => a.ordinal - b.ordinal);
  const firstWave = sortedWaves[0];

  if (firstWave) {
    assertTransition(WAVE_TRANSITIONS, firstWave.status as "PENDING", "READY");
    await db.update(waves).set({ status: "READY" }).where(eq(waves.id, firstWave.id));

    assertTransition(WAVE_TRANSITIONS, "READY" as const, "RUNNING");
    await db.update(waves).set({ status: "RUNNING", startedAt: new Date() }).where(eq(waves.id, firstWave.id));

    // 3. Assign tasks in the first wave (with policy evaluation)
    const waveTasks = await db.select().from(tasks).where(eq(tasks.waveId, firstWave.id));
    const policyResults: Array<{ taskId: string; allowed: boolean; reason: string; riskLevel?: string }> = [];

    for (const task of waveTasks) {
      // Policy evaluation before assignment
      const policyDecision = policyEngine.evaluate({
        role: task.role as any,
        action: task.description,
        context: { title: task.title, engine: task.engine },
      });

      if (!policyDecision.allow) {
        // Task blocked by policy — mark as BLOCKED
        assertTransition(TASK_TRANSITIONS, task.status as "QUEUED", "BLOCKED");
        await db.update(tasks).set({ status: "BLOCKED", updatedAt: new Date() }).where(eq(tasks.id, task.id));
        policyResults.push({
          taskId: task.id,
          allowed: false,
          reason: policyDecision.reason,
          riskLevel: policyDecision.riskLevel,
        });

        await publishEvent("approval.requested", {
          approvalId: task.id,
          reason: policyDecision.reason,
        }, {
          taskId: task.id,
          missionId: id,
          workspaceId: missionData.workspaceId,
        });

        logger.warn("Task blocked by policy", { taskId: task.id, reason: policyDecision.reason });
        continue;
      }

      assertTransition(TASK_TRANSITIONS, task.status as "QUEUED", "ASSIGNED");
      await db.update(tasks).set({ status: "ASSIGNED", updatedAt: new Date() }).where(eq(tasks.id, task.id));
      policyResults.push({
        taskId: task.id,
        allowed: true,
        reason: "Policy check passed",
        riskLevel: policyDecision.riskLevel,
      });

      // 4. Publish typed event via EventBus
      await publishEvent("task.assigned", {
        assignedTo: task.role,
        role: task.role,
        engine: task.engine,
        title: task.title,
        description: task.description,
      }, {
        taskId: task.id,
        missionId: id,
        waveId: firstWave.id,
        workspaceId: missionData.workspaceId,
      });
    }

    // 5. Publish mission.started event
    await publishEvent("mission.started", {
      startedAt: new Date().toISOString(),
    }, { missionId: id, workspaceId: missionData.workspaceId });

    logger.info("Mission started", {
      missionId: id,
      wave: firstWave.ordinal,
      tasks: waveTasks.length,
      totalWaves: sortedWaves.length,
    });

    const assigned = policyResults.filter(r => r.allowed).length;
    const blocked = policyResults.filter(r => !r.allowed).length;

    return c.json({
      status: "RUNNING",
      activeWave: firstWave.ordinal,
      tasksAssigned: assigned,
      tasksBlocked: blocked,
      totalWaves: sortedWaves.length,
      policyResults,
    });
  }

  return c.json({ status: "RUNNING", tasksAssigned: 0 });
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

// POST /:missionId/tasks/:taskId/unblock — Unblock a task after approval is granted
missionRoutes.post("/:missionId/tasks/:taskId/unblock", async (c) => {
  const missionId = c.req.param("missionId");
  const taskId = c.req.param("taskId");

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) return c.json({ error: "Task not found" }, 404);
  if (task.missionId !== missionId) return c.json({ error: "Task does not belong to this mission" }, 400);
  if (task.status !== "BLOCKED") return c.json({ error: `Task is not BLOCKED (current: ${task.status})` }, 409);

  // BLOCKED → QUEUED → ASSIGNED
  assertTransition(TASK_TRANSITIONS, task.status as "BLOCKED", "QUEUED");
  await db.update(tasks).set({ status: "QUEUED", updatedAt: new Date() }).where(eq(tasks.id, taskId));

  assertTransition(TASK_TRANSITIONS, "QUEUED" as const, "ASSIGNED");
  await db.update(tasks).set({ status: "ASSIGNED", updatedAt: new Date() }).where(eq(tasks.id, taskId));

  // Publish task.assigned event
  await publishEvent("task.assigned", {
    assignedTo: task.role,
    role: task.role,
    engine: task.engine,
    title: task.title,
    description: task.description,
  }, {
    taskId: task.id,
    missionId,
    waveId: task.waveId,
  });

  logger.info("Task unblocked after approval", { taskId, missionId });

  return c.json({ status: "ASSIGNED", taskId, missionId });
});
