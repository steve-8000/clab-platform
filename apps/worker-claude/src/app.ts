import { Hono } from "hono";
import { cors } from "hono/cors";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@clab/db";
import { eq } from "drizzle-orm";

const { tasks, taskRuns, artifacts } = schema;
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://clab:clab-stg-pass@postgres:5432/clab";
const sql = postgres(DATABASE_URL);
const db = drizzle(sql, { schema });

export async function executeTask(taskId: string): Promise<"SUCCEEDED" | "FAILED"> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) { console.error(`Task ${taskId} not found`); return "FAILED"; }

  const [run] = await db.insert(taskRuns).values({
    taskId: task.id,
    attempt: 1,
    status: "RUNNING",
  }).returning();

  await db.update(tasks).set({ status: "RUNNING", updatedAt: new Date() }).where(eq(tasks.id, taskId));

  console.log(`[worker-claude] Executing (${task.role}): ${task.title}`);

  // Execute via Claude API or simulate
  let output: string;
  let success = true;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (ANTHROPIC_API_KEY) {
    const systemPrompts: Record<string, string> = {
      PM: "You are a project manager. Decompose the given objective into clear subtasks with priorities and dependencies. Be structured and concise.",
      OPERATIONS_REVIEWER: "You are a code reviewer. Analyze the given code or description for bugs, security issues, and quality. Provide a clear verdict: APPROVED or NEEDS_CHANGES with specific issues.",
      BUILDER: "You are a software builder. Implement the given task with clean, well-tested code following best practices.",
      ARCHITECT: "You are a software architect. Design systems, define interfaces, and make technology decisions with clear rationale.",
      STRATEGIST: "You are a strategic advisor. Analyze situations and provide actionable recommendations.",
      RESEARCH_ANALYST: "You are a research analyst. Research the given topic, provide evidence-based findings, and give actionable recommendations.",
    };

    const systemPrompt = systemPrompts[task.role] || "You are an AI assistant. Complete the given task thoroughly.";

    console.log(`[worker-claude] Calling Claude API for (${task.role}): ${task.title}`);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: task.description }],
        }),
      });

      if (res.ok) {
        const data = await res.json() as { content: Array<{ text: string }> };
        output = data.content.map((c) => c.text).join("\n");
      } else {
        output = `[Claude API Error ${res.status}]: ${await res.text()}`;
        console.error(`[worker-claude] Claude API error: ${res.status}`);
        success = false;
      }
    } catch (err) {
      output = `[Claude API Error]: ${String(err)}`;
      console.error(`[worker-claude] Claude API call failed:`, err);
      success = false;
    }
  } else {
    // Simulation fallback
    console.log(`[worker-claude] No ANTHROPIC_API_KEY — simulating`);
    switch (task.role) {
      case "OPERATIONS_REVIEWER":
        output = `[SIMULATED Review] Reviewed: ${task.title}\n\nFindings:\n- Code follows established patterns\n- No security issues detected\n- Test coverage appears adequate\n\nVerdict: APPROVED`;
        break;
      case "PM":
        output = `[SIMULATED PM Analysis] ${task.title}\n\nDecomposition:\n- Subtask 1: Setup and configuration\n- Subtask 2: Core implementation\n- Subtask 3: Testing and validation\n\nPriority: High\nEstimated effort: Medium`;
        break;
      case "RESEARCH_ANALYST":
        output = `[SIMULATED Research] ${task.title}\n\nFindings:\n- Analyzed relevant documentation\n- Compared approaches\n- Recommendation: Use established pattern\n\nEvidence: Based on project conventions`;
        break;
      default:
        output = `[SIMULATED Claude] Completed: ${task.title}\n\nAnalysis: ${task.description}`;
    }
  }

  const finalStatus = success ? "SUCCEEDED" : "FAILED";

  await db.update(taskRuns).set({
    status: finalStatus,
    stdout: output,
    durationMs: 2000,
    finishedAt: new Date(),
  }).where(eq(taskRuns.id, run.id));

  await db.insert(artifacts).values({
    taskRunId: run.id,
    missionId: task.missionId,
    type: "SUMMARY",
    content: output,
    metadata: { role: task.role, engine: "CLAUDE" },
  });

  await db.update(tasks).set({ status: finalStatus, completedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, taskId));

  console.log(`[worker-claude] Task ${taskId} ${finalStatus}`);
  return finalStatus;
}

export const app = new Hono()
  .use("*", cors())
  .get("/health", (c) => c.json({ status: "ok", service: "worker-claude" }))
  .post("/execute", async (c) => {
    const body = await c.req.json();
    if (!body.taskId) return c.json({ error: "taskId required" }, 400);
    const status = await executeTask(body.taskId);
    return c.json({ status, taskId: body.taskId });
  });
