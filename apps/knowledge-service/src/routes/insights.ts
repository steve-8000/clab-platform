import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { store, bus, ensureBus } from "../store.js";
import { extractKeywords } from "../services/keyword-extractor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface TaskResult {
  status: string;
  summary: string;
  changedFiles: string[];
  artifacts: Array<{ type: string; uri: string }>;
  risks: string[];
  followups: string[];
  metrics: {
    elapsedMs: number;
    tokenIn?: number;
    tokenOut?: number;
    costUsd?: number;
  };
}

export interface Insight {
  id: string;
  taskRunId: string;
  type: "pattern" | "decision" | "risk" | "learning";
  title: string;
  description: string;
  evidence: string[];
  tags: string[];
  createdAt: string;
}

const insights = new Hono();

// ---------------------------------------------------------------------------
// POST /extract — Extract insights from a task run result
// ---------------------------------------------------------------------------
insights.post("/extract", async (c) => {
  await ensureBus();

  const body = await c.req.json<{
    taskRunId: string;
    result: TaskResult;
    context: string;
  }>();

  if (!body.taskRunId || !body.result) {
    return c.json(
      { ok: false, error: "taskRunId and result are required" },
      400,
    );
  }

  try {
    const extracted: Insight[] = [];
    const { result, context } = body;
    const combinedText = `${result.summary} ${context}`;

    // 1. Analyze for patterns — look for recurring keywords that suggest patterns
    const keywords = extractKeywords(combinedText, 6);
    if (keywords.length >= 3) {
      extracted.push({
        id: randomUUID(),
        taskRunId: body.taskRunId,
        type: "pattern",
        title: `Pattern: ${keywords.slice(0, 3).join(", ")}`,
        description: `Recurring themes detected in task output: ${keywords.join(", ")}`,
        evidence: [result.summary.slice(0, 500)],
        tags: keywords,
        createdAt: new Date().toISOString(),
      });
    }

    // 2. Analyze for decisions — look for decision indicators in summary
    const decisionIndicators = [
      "decided",
      "chose",
      "selected",
      "opted",
      "switched",
      "migrated",
      "replaced",
      "adopted",
    ];
    const summaryLower = result.summary.toLowerCase();
    const hasDecision = decisionIndicators.some((d) =>
      summaryLower.includes(d),
    );
    if (hasDecision) {
      extracted.push({
        id: randomUUID(),
        taskRunId: body.taskRunId,
        type: "decision",
        title: `Decision recorded from task ${body.taskRunId}`,
        description: result.summary.slice(0, 500),
        evidence: [result.summary.slice(0, 500)],
        tags: ["decision", ...keywords.slice(0, 3)],
        createdAt: new Date().toISOString(),
      });
    }

    // 3. Analyze for risks
    if (result.risks.length > 0) {
      extracted.push({
        id: randomUUID(),
        taskRunId: body.taskRunId,
        type: "risk",
        title: `${result.risks.length} risk(s) identified`,
        description: result.risks.join("; "),
        evidence: result.risks,
        tags: ["risk", ...keywords.slice(0, 2)],
        createdAt: new Date().toISOString(),
      });
    }

    // 4. Store each insight as a knowledge entry
    for (const insight of extracted) {
      await store.store({
        topic: insight.title,
        content: insight.description,
        tags: insight.tags,
        source: "EXTRACTED",
        confidence: 0.8,
      });
    }

    // 5. Emit knowledge.extracted event
    if (extracted.length > 0) {
      try {
        await bus.publish({
          id: randomUUID(),
          type: "knowledge.extracted",
          version: 1,
          occurredAt: new Date().toISOString(),
          actor: { kind: "system", id: "knowledge-service" },
          payload: {
            taskRunId: body.taskRunId,
            insightCount: extracted.length,
            types: extracted.map((i) => i.type),
          },
        });
      } catch (pubErr) {
        console.warn(
          `[knowledge-service] Failed to publish knowledge.extracted event for taskRun=${body.taskRunId}:`,
          pubErr,
        );
      }
    }

    return c.json({
      ok: true,
      insights: extracted,
      count: extracted.length,
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /insights?missionId=... — list insights (filtered by tags/mission)
// ---------------------------------------------------------------------------
insights.get("/", async (c) => {
  const missionId = c.req.query("missionId");

  try {
    let entries;
    if (missionId) {
      entries = await store.getByTags([missionId]);
    } else {
      // Return all extracted entries
      entries = await store.search("", 100);
    }

    // Filter to EXTRACTED source only
    const insightEntries = entries.filter((e) => e.source === "EXTRACTED");

    return c.json({
      ok: true,
      insights: insightEntries,
      count: insightEntries.length,
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export { insights as insightRoutes };
