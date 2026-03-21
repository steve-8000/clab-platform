import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDb(url?: string) {
  const connection = postgres(
    url ||
      process.env.DATABASE_URL ||
      "postgresql://clab:clab@localhost:5432/clab",
  );
  return drizzle(connection, { schema });
}

export type Database = ReturnType<typeof createDb>;
