import { Hono } from "hono";
import { cors } from "hono/cors";
import { missionRoutes } from "./routes/missions.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { sql, eventBusConnected, logger } from "./deps.js";

export const app = new Hono()
  .use("*", cors())
  .route("/v1/missions", missionRoutes)
  .route("/v1/workspaces", workspaceRoutes)
  .get("/health", async (c) => {
    const checks: Record<string, string> = {};
    let healthy = true;

    // Check database connectivity
    try {
      await sql`SELECT 1`;
      checks.database = "ok";
    } catch (err) {
      checks.database = "fail";
      healthy = false;
      logger.warn("Health check: database unreachable", { error: String(err) });
    }

    // Check EventBus connection
    checks.eventBus = eventBusConnected ? "ok" : "fail";
    if (!eventBusConnected) healthy = false;

    const status = healthy ? "ok" : "degraded";
    return c.json({ status, service: "orchestrator", checks }, healthy ? 200 : 503);
  });
