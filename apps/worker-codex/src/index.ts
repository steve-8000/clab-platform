import { serve } from "@hono/node-server";
import { app, executeTask, initEventBus, closeEventBus } from "./app.js";
import { connect, JSONCodec, type NatsConnection, type Subscription } from "nats";
import { createLogger } from "@clab/telemetry";

const logger = createLogger("worker-codex");

const port = Number(process.env.PORT) || 4003;
const NATS_URL = process.env.NATS_URL || "nats://nats:4222";
const jc = JSONCodec();

// Track resources for graceful shutdown
let natsConnection: NatsConnection | null = null;
let natsSubscription: Subscription | null = null;
let httpServer: ReturnType<typeof serve> | null = null;

async function startNatsSubscriber() {
  try {
    const nc = await connect({ servers: NATS_URL });
    natsConnection = nc;
    logger.info("Connected to NATS");

    const sub = nc.subscribe("clab.*.task.assigned");
    natsSubscription = sub;

    (async () => {
      for await (const msg of sub) {
        try {
          const data = jc.decode(msg.data) as Record<string, unknown>;
          const engine = data.engine as string;

          // Only handle CODEX tasks
          if (engine !== "CODEX") continue;

          logger.info(`Received task: ${data.taskId} — ${data.title}`, { taskId: data.taskId as string });
          const status = await executeTask(data.taskId as string);

          // Publish completion/failure event via NATS
          nc.publish(`clab.${data.workspaceId || "*"}.task.completed`, jc.encode({
            taskId: data.taskId,
            missionId: data.missionId,
            waveId: data.waveId,
            workspaceId: data.workspaceId,
            status,
          }));
        } catch (err) {
          logger.error("Error processing task", { error: String(err) });
        }
      }
    })();
  } catch (err) {
    logger.warn("Worker started in HTTP-only mode - NATS task subscription unavailable", { error: String(err) });
  }
}

async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  // 1. Unsubscribe from NATS
  if (natsSubscription) {
    natsSubscription.unsubscribe();
    natsSubscription = null;
  }

  // 2. Drain and close the NATS connection
  if (natsConnection) {
    try {
      await natsConnection.drain();
    } catch (err) {
      logger.warn("NATS drain error during shutdown", { error: String(err) });
    }
    natsConnection = null;
  }

  // 3. Close EventBus
  await closeEventBus();

  // 4. Close the HTTP server
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }

  logger.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => { void gracefulShutdown("SIGTERM"); });
process.on("SIGINT", () => { void gracefulShutdown("SIGINT"); });

httpServer = serve({ fetch: app.fetch, port }, () => {
  logger.info(`Worker-Codex listening on port ${port}`);
  const executionMode = process.env.EXECUTION_MODE || "k8s";
  if (executionMode === "local") {
    logger.info("EXECUTION_MODE=local — NATS subscribe disabled (clab plugin handles execution)");
  } else {
    void initEventBus();
    void startNatsSubscriber();
  }
});
