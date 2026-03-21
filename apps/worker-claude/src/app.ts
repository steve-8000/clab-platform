import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { executeRoutes } from "./routes/execute.js";

export const app = new Hono()
  .use("*", cors())
  .use("*", logger())
  .route("/", executeRoutes)
  .get("/health", (c) => c.json({ status: "ok", service: "worker-claude" }));
