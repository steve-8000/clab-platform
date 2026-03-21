import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { bus, isBusConnected } from "./store.js";

const PORT = Number(process.env.PORT ?? 4007);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[knowledge-service] listening on http://localhost:${info.port}`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal: string): Promise<void> {
  console.log(`[knowledge-service] ${signal} received — shutting down`);

  // 1. Drain EventBus connection if connected
  if (isBusConnected()) {
    try {
      await bus.close();
      console.log("[knowledge-service] EventBus connection closed");
    } catch (err) {
      console.warn("[knowledge-service] Error closing EventBus:", err);
    }
  }

  // 2. Close HTTP server
  server.close(() => {
    console.log("[knowledge-service] HTTP server closed");
    process.exit(0);
  });

  // Force exit after 5 seconds if graceful shutdown stalls
  setTimeout(() => {
    console.error("[knowledge-service] Forced exit after timeout");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
