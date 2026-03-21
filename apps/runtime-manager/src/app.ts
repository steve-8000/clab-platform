import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { sessionRoutes } from "./routes/sessions.js";

export const app = new Hono()
  .use("*", cors())
  .use("*", logger())
  .route("/sessions", sessionRoutes)
  .get("/health", (c) => c.json({ status: "ok", service: "runtime-manager" }));
