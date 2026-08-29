import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

// Next.js re-evaluates modules on every hot reload, so the pool is cached on
// globalThis to avoid leaking a new set of connections each time. Creation is
// lazy so that importing this module during `next build` — where DATABASE_URL
// is typically absent — does not fail.
const globalForDb = globalThis as unknown as { pool?: Pool; db?: Db };

export function getDb(): Db {
  if (globalForDb.db) return globalForDb.db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const pool = globalForDb.pool ?? new Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });

  globalForDb.pool = pool;
  globalForDb.db = db;
  return db;
}

export { schema };
