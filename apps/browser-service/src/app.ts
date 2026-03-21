import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { browserRoutes } from "./routes/browser.js";

export const app = new Hono()
  .use("*", cors())
  .use("*", logger())
  .route("/", browserRoutes)
  .get("/health", (c) => c.json({ status: "ok", service: "browser-service" }));
