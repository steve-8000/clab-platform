import { serve } from "@hono/node-server";
import { app, reviewTask } from "./app.js";
import { connect, JSONCodec } from "nats";

const port = Number(process.env.PORT) || 4006;
const NATS_URL = process.env.NATS_URL || "nats://nats:4222";
const jc = JSONCodec();

async function startNatsSubscriber() {
  try {
    const nc = await connect({ servers: NATS_URL });
    console.log("[review-service] Connected to NATS");

    const sub = nc.subscribe("clab.task.completed");

    (async () => {
      for await (const msg of sub) {
        try {
          const data = jc.decode(msg.data) as Record<string, unknown>;
          console.log(`[review-service] Reviewing task: ${data.taskId}`);

          const result = await reviewTask(data.taskId as string);

          // Publish review result
          nc.publish("clab.review.completed", jc.encode({
            taskId: data.taskId,
            missionId: data.missionId,
            passed: result.passed,
            issues: result.issues,
          }));
        } catch (err) {
          console.error("[review-service] Error reviewing task:", err);
        }
      }
    })();
  } catch (err) {
    console.error("[review-service] NATS connection failed, running HTTP-only mode:", err);
  }
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`Review-Service listening on port ${port}`);
  startNatsSubscriber();
});
