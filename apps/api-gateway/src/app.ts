import { Hono } from "hono";
import { cors } from "hono/cors";
import { restRoutes } from "./routes/rest.js";

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000"];

export const app = new Hono()
  .use(
    "*",
    cors({
      origin: allowedOrigins,
      credentials: true,
    }),
  )
  .route("/v1", restRoutes)
  .get("/health", (c) => c.json({ status: "ok", service: "api-gateway" }));
