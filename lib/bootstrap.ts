import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";

/**
 * Заводить першого власника з `BOOTSTRAP_ADMIN_EMAIL` і
 * `BOOTSTRAP_ADMIN_PASSWORD` (необов'язково `BOOTSTRAP_ADMIN_NAME`).
 *
 * Свіжий деплой стикається з глухим кутом: увійти нікому, бо жодного облікового
 * запису немає, а завести його можна лише зсередини. Дві змінні середовища
 * розв'язують це, не відкриваючи реєстрації.
 *
 * Спрацьовує **лише поки таблиця користувачів порожня** — тож це саме
 * початкове заведення, а не чорний хід: щойно власник є, змінні нічого не
 * роблять і нікого не перезаписують. Прибрати їх після першого запуску все
 * одно варто, щоб пароль не лежав у налаштуваннях сервісу.
 */
export async function bootstrapOwner(): Promise<string | null> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return null;

  if (password.length < 8) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD: щонайменше 8 символів");
  }

  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);
  if ((row?.count ?? 0) > 0) return null;

  await db.insert(users).values({
    email,
    passwordHash: await bcrypt.hash(password, 12),
    name: process.env.BOOTSTRAP_ADMIN_NAME?.trim() || null,
    role: "admin",
  });
  return email;
}
