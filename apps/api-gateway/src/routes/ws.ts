import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-server/ws";
// import { EventBus } from "@clab/events";

const ws = new Hono();

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: ws });

/**
 * GET /ws/events?workspaceId=...
 *
 * Upgrades to WebSocket. Subscribes to NATS EventBus subjects matching the
 * given workspaceId and pushes events to the connected client.
 *
 * Event subjects forwarded:
 *   task.*, session.*, mission.*, approval.*, artifact.*
 */
ws.get(
  "/events",
  upgradeWebSocket((c) => {
    const workspaceId = c.req.query("workspaceId") ?? "default";

    return {
      onOpen(_event, socket) {
        console.log(`[ws] client connected — workspace=${workspaceId}`);
        socket.send(
          JSON.stringify({
            type: "connected",
            workspaceId,
            subjects: [
              "task.*",
              "session.*",
              "mission.*",
              "approval.*",
              "artifact.*",
            ],
          }),
        );

        // TODO: subscribe to EventBus (NATS) for the workspace
        // const sub = EventBus.subscribe(`${workspaceId}.>`, (msg) => {
        //   socket.send(JSON.stringify(msg));
        // });
        // Store sub handle for cleanup in onClose
      },

      onMessage(event, socket) {
        // Clients may send ping / filter commands
        try {
          const data = JSON.parse(String(event.data));
          if (data.type === "ping") {
            socket.send(JSON.stringify({ type: "pong" }));
          }
        } catch {
          // ignore malformed messages
        }
      },

      onClose() {
        console.log(`[ws] client disconnected — workspace=${workspaceId}`);
        // TODO: unsubscribe from EventBus
      },

      onError(error) {
        console.error(`[ws] error — workspace=${workspaceId}`, error);
      },
    };
  }),
);

export { ws as wsRoutes, injectWebSocket };
