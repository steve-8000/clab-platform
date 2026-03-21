import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.PORT) || 4000;

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`API Gateway listening on port ${port}`);
});

function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log("API Gateway shut down.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
