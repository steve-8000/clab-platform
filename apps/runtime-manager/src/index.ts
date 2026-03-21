import { serve } from "@hono/node-server";
import { app } from "./app.js";

const PORT = Number(process.env.PORT ?? 4002);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[runtime-manager] listening on http://localhost:${info.port}`);
});
