import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { passwordResets, users } from "@/db/schema";
import { firstIssue, resetRequest } from "@/lib/api-schemas";
import { clearOtherTokens, findResetToken } from "@/lib/password-reset";

/**
 * Встановлення пароля за посиланням. Публічний маршрут: ключ від нього один —
 * токен із листа, якого без доступу до скриньки не вгадати.
 */

/** Одне формулювання на підроблений, прострочений і вже використаний токен —
 *  різні тексти підказували б, який саме «майже вгадано». */
const REJECTED = { error: "Посилання недійсне або вже використане" };

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const found = await findResetToken(token);
    if (!found) return Response.json(REJECTED, { status: 404 });

    const [user] = await getDb()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, found.userId));
    if (!user) return Response.json(REJECTED, { status: 404 });

    return Response.json({ email: user.email });
  } catch {
    return Response.json({ error: "PostgreSQL error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const parsed = resetRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const db = getDb();
    const found = await findResetToken(parsed.data.token);
    if (!found) return Response.json(REJECTED, { status: 404 });

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, found.userId));
    if (!user) return Response.json(REJECTED, { status: 404 });

    await db.transaction(async (tx) => {
      // Гасимо за тією ж умовою, за якою шукали: з двох одночасних запитів
      // другий оновить нуль рядків і пароль удруге не перепише.
      const claimed = await tx
        .update(passwordResets)
        .set({ usedAt: new Date() })
        .where(eq(passwordResets.id, found.id))
        .returning({ id: passwordResets.id });
      if (!claimed.length) throw new Error("TOKEN_ALREADY_USED");

      await tx
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, found.userId));

      // Старі листи після зміни пароля дійсними лишатися не мають.
      await clearOtherTokens(tx, found.userId, found.id);
    });

    return Response.json({ email: user.email });
  } catch (error) {
    if (error instanceof Error && error.message === "TOKEN_ALREADY_USED")
      return Response.json(REJECTED, { status: 409 });
    return Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}
