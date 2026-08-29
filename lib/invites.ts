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

/**
 * Публічний origin застосунку.
 *
 * За зворотним проксі — а на Railway та будь-якому PaaS він є — `request.url`
 * показує внутрішню адресу контейнера, і зібране з неї посилання нікуди не
 * веде. `NEXTAUTH_URL` і так обов'язкова й містить саме публічну адресу, тож
 * вона головна; заголовки проксі — запасний шлях, сам запит — останній.
 */
export function publicOrigin(request: Request): string {
  const configured = process.env.NEXTAUTH_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Зіпсована змінна не має ламати видачу запрошення — падаємо нижче.
    }
  }

  const host = request.headers.get("x-forwarded-host");
  if (host)
    return `${request.headers.get("x-forwarded-proto") ?? "https"}://${host}`;

  return new URL(request.url).origin;
}

/** Посилання, яке власник передає запрошеному. */
export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/register?token=${token}`;
}
