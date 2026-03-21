import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { reviewRoutes } from "./routes/reviews.js";

export const app = new Hono()
  .use("*", cors())
  .use("*", logger())
  .route("/", reviewRoutes)
  .get("/health", (c) => c.json({ status: "ok", service: "review-service" }));
