import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { preKRoutes } from "./routes/pre-k.js";
import { postKRoutes } from "./routes/post-k.js";
import { insightRoutes } from "./routes/insights.js";
import { store, isBusConnected } from "./store.js";

export const app = new Hono()
  .use("*", cors())
  .use("*", logger())
  .route("/v1/knowledge", knowledgeRoutes)
  .route("/v1/pre-k", preKRoutes)
  .route("/v1/post-k", postKRoutes)
  .route("/v1/insights", insightRoutes)
  .get("/health", async (c) => {
    let storeStatus: { totalEntries: number; topics: number; lastUpdated?: string } | null = null;
    try {
      storeStatus = await store.status();
    } catch {
      // store unavailable
    }

    return c.json({
      status: "ok",
      service: "knowledge-service",
      store: storeStatus ?? { error: "unavailable" },
      eventBus: { connected: isBusConnected() },
    });
  });
