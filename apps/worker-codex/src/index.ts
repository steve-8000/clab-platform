import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.PORT) || 4003;

serve({ fetch: app.fetch, port }, () => {
  console.log(`Worker-Codex listening on port ${port}`);
});
