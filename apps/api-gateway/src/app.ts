import { Hono } from "hono";
import { cors } from "hono/cors";
import { restRoutes } from "./routes/rest.js";
import { dashboardRoutes } from "./routes/dashboard-routes.js";

export const app = new Hono()
  .use("*", cors())
  .route("/v1", restRoutes)
  .route("/v1/dashboard", dashboardRoutes)
  .get("/health", (c) => c.json({ status: "ok", service: "api-gateway" }));
