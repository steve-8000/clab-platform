import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@clab/db";
import { createLogger } from "@clab/telemetry";

const logger = createLogger("mission-service");

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://clab:clab-stg-pass@postgres:5432/clab";
const sql = postgres(DATABASE_URL);
export const db = drizzle(sql, { schema });

export { logger };

import { connect, JSONCodec } from "nats";
import type { NatsConnection } from "nats";

let nc: NatsConnection | null = null;
const jc = JSONCodec();

export async function getNats(): Promise<NatsConnection> {
  if (!nc) {
    const url = process.env.NATS_URL || "nats://nats:4222";
    nc = await connect({ servers: url });
    logger.info("Connected to NATS", { url });
  }
  return nc;
}

export async function publishEvent(subject: string, data: Record<string, unknown>): Promise<void> {
  try {
    const conn = await getNats();
    conn.publish(subject, jc.encode(data));
  } catch (err) {
    logger.error("Failed to publish event", { subject, error: String(err) });
  }
}
