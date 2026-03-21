import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { createLogger } from "@clab/telemetry";
import { cmux, bus } from "./routes/browser.js";

const logger = createLogger("browser-service");
const PORT = Number(process.env.PORT ?? 4005);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info("Browser-Service listening", { port: info.port });
});

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info("Shutting down", { signal });
  try {
    cmux.disconnect();
    logger.info("Cmux client disconnected");
  } catch (err) {
    logger.error("Cmux disconnect failed", { error: err instanceof Error ? err.message : String(err) });
  }
  try {
    await bus.close();
    logger.info("EventBus drained");
  } catch (err) {
    logger.error("EventBus drain failed", { error: err instanceof Error ? err.message : String(err) });
  }
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
