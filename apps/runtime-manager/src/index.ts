import { serve } from "@hono/node-server";
import { app, sql } from "./app.js";
import { startSessionManager, stopSessionManager } from "./session-manager.js";
import { startHeartbeatMonitor, stopHeartbeatMonitor } from "./heartbeat.js";

const port = Number(process.env.PORT) || 4002;

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`Runtime-Manager listening on port ${port}`);
  startSessionManager();
  startHeartbeatMonitor();
});

// Graceful shutdown handler
async function shutdown(signal: string): Promise<void> {
  console.log(`[runtime-manager] ${signal} received — shutting down gracefully`);

  // 1. Stop heartbeat monitor (no more scheduled checks)
  stopHeartbeatMonitor();

  // 2. Drain NATS connection (finishes in-flight messages, then closes)
  await stopSessionManager();

  // 3. Close HTTP server
  server.close();

  // 4. Close database connection
  await sql.end();

  console.log("[runtime-manager] Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
