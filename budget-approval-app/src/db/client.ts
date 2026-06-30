import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
}

// A pooled connection is reused across hot-reloads in dev so we don't leak
// connections on every file save.
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

export const pool =
  global.__pgPool ??
  new Pool({
    connectionString,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  global.__pgPool = pool;
}

export const db = drizzle(pool, { schema });
