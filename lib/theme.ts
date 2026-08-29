import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { getDb } from "@/db";
import { branches, users } from "@/db/schema";
import type { ColorTheme } from "./api-schemas";
import { authOptions } from "./auth";

export const DEFAULT_THEME: ColorTheme = "green";

/**
 * У якій схемі малювати інтерфейс цього користувача.
 *
 * Власник має особисту схему й вона важливіша за все інше — він же дивиться на
 * кілька філій одразу, і перефарбовування на кожному перемиканні тільки
 * заважало б. Керуючий прив'язаний до однієї філії, тож бачить її схему.
 */
export async function resolveTheme(): Promise<ColorTheme> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return DEFAULT_THEME;

  try {
    const [row] = await getDb()
      .select({ theme: users.theme, branchTheme: branches.theme })
      .from(users)
      .leftJoin(branches, eq(branches.id, users.branchId))
      .where(eq(users.id, Number(session.user.id)));

    return row?.theme ?? row?.branchTheme ?? DEFAULT_THEME;
  } catch {
    // Схема — оздоблення. Якщо база недоступна, сторінка все одно має
    // відкритися й показати свою помилку, а не впасти на кольорі.
    return DEFAULT_THEME;
  }
}
