import { Hono } from "hono";
import { missionRoutes } from "./routes/missions.js";
import { taskRoutes } from "./routes/tasks.js";
import { waveRoutes } from "./routes/waves.js";

export const app = new Hono()
  .route("/v1/missions", missionRoutes)
  .route("/v1/tasks", taskRoutes)
  .route("/v1/waves", waveRoutes)
  .get("/health", (c) => c.json({ status: "ok", service: "mission-service" }));
