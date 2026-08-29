import nodemailer, { type Transporter } from "nodemailer";

/**
 * Надсилання пошти.
 *
 * SMTP, а не API конкретного сервісу: так одна змінна `SMTP_URL` покриває і
 * Resend, і Postmark, і скриньку на власному домені — прив'язуватися до
 * котрогось одного немає причин.
 *
 * Якщо `SMTP_URL` не задано, лист не зникає мовчки: він друкується в лог
 * сервера. Локально це рятує від підняття поштового стека заради одного
 * посилання, а на проді відсутність змінної одразу видно в логах.
 */

type Letter = { to: string; subject: string; text: string };

const globalForMail = globalThis as unknown as { mailer?: Transporter };

function transport(): Transporter | null {
  const url = process.env.SMTP_URL?.trim();
  if (!url) return null;
  // З'єднання кешується так само, як пул бази: інакше кожен лист відкривав би
  // власне, а гаряче перезавантаження плодило б їх десятками.
  globalForMail.mailer ??= nodemailer.createTransport(url);
  return globalForMail.mailer;
}

export async function sendMail(letter: Letter): Promise<"sent" | "logged"> {
  const mailer = transport();
  if (!mailer) {
    console.log(
      `[пошта не налаштована] ${letter.to} — ${letter.subject}\n${letter.text}`,
    );
    return "logged";
  }

  await mailer.sendMail({
    from: process.env.MAIL_FROM?.trim() || "Малеча <no-reply@malecha.local>",
    ...letter,
  });
  return "sent";
}

/** Лист із посиланням на встановлення пароля. Один на обидва шляхи: і
 *  «забули пароль», і зміну з налаштувань — текст різниться лише вступом. */
export function passwordLetter(
  link: string,
  hours: number,
  forgotten: boolean,
): Omit<Letter, "to"> {
  return {
    subject: forgotten ? "Відновлення пароля — Малеча" : "Зміна пароля — Малеча",
    text: [
      forgotten
        ? "Ви (або хтось) попросили відновити пароль до системи «Малеча»."
        : "Ви попросили змінити пароль до системи «Малеча».",
      "",
      "Посилання діє " + hours + " год і спрацьовує один раз:",
      link,
      "",
      forgotten
        ? "Якщо це були не ви — просто зітріть цей лист. Пароль лишиться попереднім."
        : "Якщо це були не ви — зітріть лист і скажіть власнику садочка.",
    ].join("\n"),
  };
}
