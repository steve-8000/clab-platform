import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { app, executeTask } from "./app.js";
import { connect, JSONCodec } from "nats";
import type { NatsConnection, Subscription } from "nats";

const port = Number(process.env.PORT) || 4004;
const NATS_URL = process.env.NATS_URL || "nats://nats:4222";
const jc = JSONCodec();

let natsConn: NatsConnection | null = null;
let natsSub: Subscription | null = null;
let httpServer: ServerType | null = null;

async function startNatsSubscriber() {
  try {
    natsConn = await connect({ servers: NATS_URL });
    console.log("[worker-claude] Connected to NATS");

    natsSub = natsConn.subscribe("clab.*.task.assigned");

    (async () => {
      for await (const msg of natsSub) {
        try {
          const data = jc.decode(msg.data) as Record<string, unknown>;
          const engine = data.engine as string;

          // Only handle CLAUDE tasks
          if (engine !== "CLAUDE") continue;

          console.log(`[worker-claude] Received task: ${data.taskId} (${data.role})`);
          const status = await executeTask(data.taskId as string);

          natsConn!.publish(`clab.${data.workspaceId || "*"}.task.completed`, jc.encode({
            taskId: data.taskId,
            missionId: data.missionId,
            waveId: data.waveId,
            workspaceId: data.workspaceId,
            status,
          }));
        } catch (err) {
          console.error("[worker-claude] Error:", err);
        }
      }
    })();
  } catch (err) {
    console.error("[worker-claude] NATS failed, HTTP-only mode:", err);
  }
}

async function gracefulShutdown(signal: string) {
  console.log(`[worker-claude] ${signal} received — shutting down`);
  if (natsSub) { natsSub.unsubscribe(); natsSub = null; }
  if (natsConn) { await natsConn.drain(); natsConn = null; }
  if (httpServer) { httpServer.close(); httpServer = null; }
  process.exit(0);
}

process.on("SIGTERM", () => { void gracefulShutdown("SIGTERM"); });
process.on("SIGINT", () => { void gracefulShutdown("SIGINT"); });

httpServer = serve({ fetch: app.fetch, port }, () => {
  console.log(`Worker-Claude listening on port ${port}`);
  const executionMode = process.env.EXECUTION_MODE || "k8s";
  if (executionMode === "local") {
    console.log("[worker-claude] EXECUTION_MODE=local — NATS subscribe disabled (clab plugin handles execution)");
  } else {
    startNatsSubscriber();
  }
});
