import { Hono } from "hono";
import { cors } from "hono/cors";
import { missionRoutes } from "./routes/missions.js";
import { workspaceRoutes } from "./routes/workspaces.js";

export const app = new Hono()
  .use("*", cors())
  .route("/v1/missions", missionRoutes)
  .route("/v1/workspaces", workspaceRoutes)
  .get("/health", (c) => c.json({ status: "ok", service: "mission-service" }));
