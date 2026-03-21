import { Hono } from "hono";
import { createDb } from "@clab/db";
import { EventBus } from "@clab/events";
import { ReviewService } from "../services/reviewer.js";

const db = createDb();
const bus = new EventBus();
const reviewer = new ReviewService(db, bus);

let initialized = false;
async function ensureInit(): Promise<void> {
  if (initialized) return;
  await bus.connect();
  initialized = true;
}

const reviews = new Hono();

// ---------------------------------------------------------------------------
// POST /review — submit task result for review
// ---------------------------------------------------------------------------
reviews.post("/review", async (c) => {
  await ensureInit();

  const body = await c.req.json<{
    taskRun: {
      id: string;
      taskId: string;
      engine: string;
      sessionId?: string;
      status: string;
    };
    result: {
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
    };
  }>();

  if (!body.taskRun || !body.result) {
    return c.json({ ok: false, error: "taskRun and result are required" }, 400);
  }

  try {
    const reviewResult = await reviewer.review(
      body.taskRun as any,
      body.result as any,
    );
    return c.json({ ok: true, review: reviewResult });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /pending — list pending reviews
// ---------------------------------------------------------------------------
reviews.get("/pending", async (c) => {
  await ensureInit();

  try {
    const pending = await reviewer.listPending();
    return c.json({ ok: true, pending, count: pending.length });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export { reviews as reviewRoutes };
