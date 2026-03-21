import { Hono } from "hono";
import { cors } from "hono/cors";
import { missionRoutes } from "./routes/missions.js";

export const app = new Hono()
  .use("*", cors())
  .route("/v1/missions", missionRoutes)
  .get("/health", (c) => c.json({ status: "ok", service: "mission-service" }));
