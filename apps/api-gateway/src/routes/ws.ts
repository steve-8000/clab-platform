import { Hono } from "hono";

const ws = new Hono();

/**
 * GET /ws/events?workspaceId=...
 *
 * WebSocket event stream endpoint.
 * TODO: integrate with @hono/node-server WebSocket upgrade once NATS is connected.
 */
ws.get("/events", (c) => {
  const workspaceId = c.req.query("workspaceId") ?? "default";
  return c.json({
    message: "WebSocket upgrade not yet implemented. Use REST polling.",
    workspaceId,
    subjects: [
      "task.*",
      "session.*",
      "mission.*",
      "approval.*",
      "artifact.*",
    ],
  });
});

export { ws as wsRoutes };
