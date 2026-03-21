import { serve } from "@hono/node-server";
import { app, reviewTask } from "./app.js";
import { EventBus, createEvent } from "@clab/events";
import type { EventEnvelope } from "@clab/events";

const port = Number(process.env.PORT) || 4006;
const NATS_URL = process.env.NATS_URL || "nats://nats:4222";

async function startEventSubscriber() {
  const eventBus = new EventBus();
  try {
    await eventBus.connect(NATS_URL);
    console.log("[review-service] EventBus connected");

    // Subscribe to task.run.completed — auto-review
    await eventBus.subscribe("task.run.completed", async (event: EventEnvelope) => {
      try {
        const taskId = event.taskId ?? (event.payload.taskId as string);
        if (!taskId) return;

        console.log(`[review-service] Reviewing task: ${taskId}`);
        const result = await reviewTask(taskId);

        // Publish review result event
        const eventType = result.passed ? "task.review_passed" : "task.review_failed";
        await eventBus.publish(createEvent(eventType, {
          reviewedBy: "review-service",
          ...(result.passed
            ? { comments: `Passed (${result.artifactCount} artifacts)` }
            : { reason: result.issues.join("; "), comments: result.issues.join("; ") }),
        }, {
          taskId,
          missionId: result.missionId,
          actor: { kind: "system", id: "review-service" },
        }));
      } catch (err) {
        console.error("[review-service] Error reviewing task:", err);
      }
    });
  } catch (err) {
    console.error("[review-service] EventBus connection failed, running HTTP-only mode:", err);
  }
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`Review-Service listening on port ${port}`);
  startEventSubscriber();
});
