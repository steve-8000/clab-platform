import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@clab/db";
import { createLogger } from "@clab/telemetry";

const logger = createLogger("mission-service");

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://clab:clab-stg-pass@postgres:5432/clab";
const sql = postgres(DATABASE_URL);
export const db = drizzle(sql, { schema });

export { logger };
