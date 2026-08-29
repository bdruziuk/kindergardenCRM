import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { getDb } from "@/db";
import { passwordResets } from "@/db/schema";

/** Скільки годин живе посилання на пароль. Лист відкривають одразу, тож
 *  довгий термін тут — лише зайве вікно для того, хто дістався скриньки. */
export const RESET_TTL_HOURS = 2;

export const newResetToken = () => randomBytes(32).toString("base64url");

/** У базі лише хеш — так само, як у запрошеннях. */
export const hashResetToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const resetUrl = (origin: string, token: string) =>
  `${origin.replace(/\/+$/, "")}/reset?token=${token}`;

/**
 * Заводить посилання для користувача й гасить його попередні невикористані.
 *
 * Друге натискання «надіслати ще раз» не має лишати два робочі ключі: чинним
 * лишається останній, і саме він у щойно надісланому листі.
 */
export async function issueResetToken(userId: number): Promise<string> {
  const db = getDb();
  const token = newResetToken();

  await db.transaction(async (tx) => {
    await tx
      .delete(passwordResets)
      .where(
        and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)),
      );
    await tx.insert(passwordResets).values({
      userId,
      tokenHash: hashResetToken(token),
      expiresAt: sql`now() + make_interval(hours => ${RESET_TTL_HOURS})`,
    });
  });

  return token;
}

/** Чинне невикористане посилання за токеном, або null. */
export async function findResetToken(token: string) {
  if (!token) return null;
  const [row] = await getDb()
    .select({ id: passwordResets.id, userId: passwordResets.userId })
    .from(passwordResets)
    .where(
      and(
        eq(passwordResets.tokenHash, hashResetToken(token)),
        isNull(passwordResets.usedAt),
        sql`${passwordResets.expiresAt} > now()`,
      ),
    );
  return row ?? null;
}

/** Гасить решту посилань користувача — після зміни пароля старі листи не
 *  мають лишатися дійсними. */
export async function clearOtherTokens(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  userId: number,
  keepId: number,
) {
  await tx
    .delete(passwordResets)
    .where(
      and(eq(passwordResets.userId, userId), ne(passwordResets.id, keepId)),
    );
}
