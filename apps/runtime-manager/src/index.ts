import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { startSessionManager } from "./session-manager.js";
import { startHeartbeatMonitor } from "./heartbeat.js";

const port = Number(process.env.PORT) || 4002;

serve({ fetch: app.fetch, port }, () => {
  console.log(`Runtime-Manager listening on port ${port}`);
  startSessionManager();
  startHeartbeatMonitor();
});
