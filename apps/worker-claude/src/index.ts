import { serve } from "@hono/node-server";
import { app, executeTask } from "./app.js";
import { connect, JSONCodec } from "nats";

const port = Number(process.env.PORT) || 4004;
const NATS_URL = process.env.NATS_URL || "nats://nats:4222";
const jc = JSONCodec();

async function startNatsSubscriber() {
  try {
    const nc = await connect({ servers: NATS_URL });
    console.log("[worker-claude] Connected to NATS");

    const sub = nc.subscribe("clab.task.assigned");

    (async () => {
      for await (const msg of sub) {
        try {
          const data = jc.decode(msg.data) as Record<string, unknown>;
          const engine = data.engine as string;

          // Only handle CLAUDE tasks
          if (engine !== "CLAUDE") continue;

          console.log(`[worker-claude] Received task: ${data.taskId} (${data.role})`);
          await executeTask(data.taskId as string);

          nc.publish("clab.task.completed", jc.encode({
            taskId: data.taskId,
            missionId: data.missionId,
            waveId: data.waveId,
            status: "SUCCEEDED",
          }));
        } catch (err) {
          console.error("[worker-claude] Error:", err);
        }
      }
    })();
  } catch (err) {
    console.error("[worker-claude] NATS failed, HTTP-only mode:", err);
  }
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`Worker-Claude listening on port ${port}`);
  const executionMode = process.env.EXECUTION_MODE || "k8s";
  if (executionMode === "local") {
    console.log("[worker-claude] EXECUTION_MODE=local — NATS subscribe disabled (clab plugin handles execution)");
  } else {
    startNatsSubscriber();
  }
});
