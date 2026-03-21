import { Hono } from "hono";
import { cors } from "hono/cors";
import { restRoutes } from "./routes/rest.js";

export const app = new Hono()
  .use("*", cors())
  .route("/v1", restRoutes)
  .get("/health", (c) => c.json({ status: "ok", service: "api-gateway" }));
