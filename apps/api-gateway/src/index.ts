import { serve } from "@hono/node-server";
import { app } from "./app.js";

const PORT = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[api-gateway] listening on http://localhost:${info.port}`);
});
