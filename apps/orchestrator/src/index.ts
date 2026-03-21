import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { logger, eventBus, sql } from "./deps.js";

const port = Number(process.env.PORT) || 4001;

const server = serve({ fetch: app.fetch, port }, () => {
  logger.info(`Orchestrator listening on port ${port}`);
});

// Graceful shutdown
function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    logger.info("HTTP server closed");
    try {
      await eventBus.close();
      logger.info("EventBus connection drained");
    } catch (err) {
      logger.warn("EventBus drain failed", { error: String(err) });
    }
    try {
      await sql.end();
      logger.info("Database connection closed");
    } catch (err) {
      logger.warn("Database close failed", { error: String(err) });
    }
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
