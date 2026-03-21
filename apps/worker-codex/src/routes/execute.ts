import { Hono } from "hono";
import { createDb } from "@clab/db";
import { CmuxSocketClient } from "@clab/cmux-adapter";
import { EventBus } from "@clab/events";
import { CodexExecutor } from "../services/executor.js";

const db = createDb();
const cmux = new CmuxSocketClient();
const bus = new EventBus();
const executor = new CodexExecutor(cmux, bus);

let initialized = false;
async function ensureInit(): Promise<void> {
  if (initialized) return;
  await cmux.connect();
  await bus.connect();
  initialized = true;
}

const execute = new Hono();

// ---------------------------------------------------------------------------
// POST /execute — execute a task run via Codex
// ---------------------------------------------------------------------------
execute.post("/execute", async (c) => {
  await ensureInit();

  const body = await c.req.json<{
    taskRun: {
      id: string;
      taskId: string;
      engine: "CODEX";
      sessionId?: string;
      status: string;
    };
    task: {
      id: string;
      missionId: string;
      waveId: string;
      role: string;
      title: string;
      instruction: string;
      inputArtifacts: string[];
      expectedOutputs: string[];
      status: string;
      retryCount: number;
      maxRetries: number;
    };
    session: {
      id: string;
      workspaceId: string;
      role: string;
      engine: "CODEX";
      paneId?: string;
      workingDir: string;
      state: string;
    };
    instruction: string;
    context: string;
  }>();

  if (!body.taskRun || !body.task || !body.session) {
    return c.json({ ok: false, error: "taskRun, task, and session are required" }, 400);
  }

  try {
    const result = await executor.execute({
      taskRun: body.taskRun as any,
      task: body.task as any,
      session: body.session as any,
      instruction: body.instruction,
      context: body.context,
    });
    return c.json({ ok: true, result });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /status — get current execution status
// ---------------------------------------------------------------------------
execute.post("/status", async (c) => {
  await ensureInit();

  const body = await c.req.json<{ paneId: string }>();

  if (!body.paneId) {
    return c.json({ ok: false, error: "paneId is required" }, 400);
  }

  try {
    const status = await executor.getStatus(body.paneId);
    return c.json({ ok: true, ...status });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export { execute as executeRoutes };
