import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { logger } from "./deps.js";

const port = Number(process.env.PORT) || 4001;

serve({ fetch: app.fetch, port }, () => {
  logger.info(`Orchestrator listening on port ${port}`);
});
