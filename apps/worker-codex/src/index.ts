import { serve } from "@hono/node-server";
import { app, executeTask } from "./app.js";
import { connect, JSONCodec } from "nats";

const port = Number(process.env.PORT) || 4003;
const NATS_URL = process.env.NATS_URL || "nats://nats:4222";
const jc = JSONCodec();

async function startNatsSubscriber() {
  try {
    const nc = await connect({ servers: NATS_URL });
    console.log("[worker-codex] Connected to NATS");

    const sub = nc.subscribe("clab.task.assigned");

    (async () => {
      for await (const msg of sub) {
        try {
          const data = jc.decode(msg.data) as Record<string, unknown>;
          const engine = data.engine as string;

          // Only handle CODEX tasks
          if (engine !== "CODEX") continue;

          console.log(`[worker-codex] Received task: ${data.taskId} — ${data.title}`);
          await executeTask(data.taskId as string);

          // Publish completion event
          nc.publish("clab.task.completed", jc.encode({
            taskId: data.taskId,
            missionId: data.missionId,
            waveId: data.waveId,
            status: "SUCCEEDED",
          }));
        } catch (err) {
          console.error("[worker-codex] Error processing task:", err);
        }
      }
    })();
  } catch (err) {
    console.error("[worker-codex] NATS connection failed, running HTTP-only mode:", err);
  }
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`Worker-Codex listening on port ${port}`);
  const executionMode = process.env.EXECUTION_MODE || "k8s";
  if (executionMode === "local") {
    console.log("[worker-codex] EXECUTION_MODE=local — NATS subscribe disabled (clab plugin handles execution)");
  } else {
    startNatsSubscriber();
  }
});
