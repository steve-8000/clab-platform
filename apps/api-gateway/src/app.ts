import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { restRoutes } from "./routes/rest.js";
import { wsRoutes } from "./routes/ws.js";
import { mcpHandler } from "./routes/mcp.js";

export const app = new Hono()
  .use("*", cors())
  .use("*", logger())
  .route("/v1", restRoutes)
  .route("/ws", wsRoutes)
  .route("/mcp", mcpHandler)
  .get("/health", (c) => c.json({ status: "ok", service: "api-gateway" }));
