import { serve } from "@hono/node-server";
import { app, reviewTask, sql, bus, setBusConnected } from "./app.js";
import { createLogger } from "@clab/telemetry";
import { createEvent, type EventEnvelope } from "@clab/events";

const logger = createLogger("review-service");
const port = Number(process.env.PORT) || 4006;
const NATS_URL = process.env.NATS_URL || "nats://nats:4222";

async function startEventBus() {
  try {
    await bus.connect(NATS_URL);
    setBusConnected(true);
    logger.info("EventBus connected");

    await bus.subscribe("*.task.completed", async (event) => {
      try {
        const data = event.payload as Record<string, unknown>;
        const taskId = (data.taskId ?? event.payload?.taskId) as string;
        logger.info("Reviewing task from EventBus", { taskId });

        const result = await reviewTask(taskId);

        await bus.publish(createEvent("review.completed", {
          taskId,
          missionId: result.missionId,
          passed: result.passed,
          issues: result.issues,
        }, { actor: { kind: "system", id: "review-service" } }));
      } catch (err) {
        logger.error("Error reviewing task", { error: err instanceof Error ? err.message : String(err) });
      }
    });
  } catch (err) {
    logger.warn("EventBus connection failed, running HTTP-only mode", { error: err instanceof Error ? err.message : String(err) });
  }
}

const server = serve({ fetch: app.fetch, port }, () => {
  logger.info("Review-Service listening", { port });
  startEventBus();
});

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info("Shutting down", { signal });
  try {
    await bus.close();
    setBusConnected(false);
    logger.info("EventBus drained");
  } catch (err) {
    logger.error("EventBus drain failed", { error: err instanceof Error ? err.message : String(err) });
  }
  try {
    await sql.end();
    logger.info("DB connection closed");
  } catch (err) {
    logger.error("DB close failed", { error: err instanceof Error ? err.message : String(err) });
  }
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
