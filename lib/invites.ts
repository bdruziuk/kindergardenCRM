import { createHash, randomBytes } from "node:crypto";

/** Скільки днів живе запрошення, якщо не вказано інше. */
export const INVITE_DEFAULT_DAYS = 7;

/**
 * Токен запрошення. 32 байти з `randomBytes` — криптографічно стійкі, на
 * відміну від `Math.random()`, яким таке іноді роблять; base64url, щоб
 * посилання лишалось посиланням без екранування.
 */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * У базі лежить лише хеш: маючи дамп, робочого посилання не зібрати.
 * SHA-256, а не bcrypt — токен і так має 256 бітів ентропії, перебирати його
 * нікому, зате детермінований хеш дає пошук за унікальним індексом замість
 * звіряння з кожним рядком.
 */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Посилання, яке власник передає запрошеному. */
export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/register?token=${token}`;
}
