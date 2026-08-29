import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * Застосовує міграції з `drizzle/`.
 *
 * `drizzle-kit migrate` тут не годиться: він живе в devDependencies і читає
 * `drizzle.config.ts`, а в продакшн-образі немає ні того, ні того. Тому ті самі
 * міграції накочуємо програмно — тим самим драйвером, що й застосунок.
 *
 * Пул свій і одноразовий: міграції потрібні один раз на старті, а кешований на
 * `globalThis` пул застосунку має жити далі, тож його не чіпаємо.
 */
export async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  } finally {
    await pool.end();
  }
}
