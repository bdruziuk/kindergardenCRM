import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { firstIssue, forgotRequest } from "@/lib/api-schemas";
import { publicOrigin } from "@/lib/invites";
import { passwordLetter, sendMail } from "@/lib/mailer";
import { RESET_TTL_HOURS, issueResetToken, resetUrl } from "@/lib/password-reset";

/**
 * «Забули пароль»: публічний маршрут, тож він виключений із matcher-а proxy.ts.
 *
 * Відповідь **завжди однакова**, є така пошта в системі чи ні. Інакше форма
 * перетворилася б на перевірку, хто працює в садочку: ввів адресу — дізнався,
 * чи вона тут заведена. У базі імена дітей і телефони батьків, і такий натяк
 * теж зайвий.
 */
export async function POST(request: Request) {
  try {
    const parsed = forgotRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const [user] = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, parsed.data.email));

    if (user) {
      const token = await issueResetToken(user.id);
      const link = resetUrl(publicOrigin(request), token);
      await sendMail({
        to: parsed.data.email,
        ...passwordLetter(link, RESET_TTL_HOURS, true),
      });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}
