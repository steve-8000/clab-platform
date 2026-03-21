import { serve } from "@hono/node-server";
import { app } from "./app.js";

const PORT = Number(process.env.PORT ?? 4004);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[worker-claude] listening on http://localhost:${info.port}`);
});
