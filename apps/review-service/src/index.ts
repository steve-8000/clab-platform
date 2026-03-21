import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.PORT) || 4006;

serve({ fetch: app.fetch, port }, () => {
  console.log(`Review-Service listening on port ${port}`);
});
