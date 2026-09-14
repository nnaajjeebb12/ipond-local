import { Pool } from "pg";
import { validateEnv } from "@/lib/env";

declare global {
  var __pgPool: Pool | undefined;
}

validateEnv();

export const pool: Pool =
  global.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // A dashboard load fires ~6 requests at once on top of ingest; at 5 the
    // sixth waited for a slot. Postgres allows 100.
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: false,
  });

if (process.env.NODE_ENV !== "production") {
  global.__pgPool = pool;
}
