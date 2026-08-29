import bcrypt from "bcryptjs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { branches, invites, users } from "@/db/schema";
import {
  type InviteCheckDto,
  firstIssue,
  registerRequest,
} from "@/lib/api-schemas";
import { hashInviteToken } from "@/lib/invites";

/**
 * Реєстрація доступна лише за запрошенням, тож обидва обробники публічні —
 * маршрут виключений із matcher-а proxy.ts. Ключ від них один: токен, якого
 * без посилання від власника не вгадати.
 */

/** Чинне, невикористане запрошення за токеном, або null. */
async function findInvite(token: string) {
  if (!token) return null;

  const [row] = await getDb()
    .select({
      id: invites.id,
      email: invites.email,
      role: invites.role,
      kindergartenId: invites.kindergartenId,
      branchId: invites.branchId,
      branchName: branches.name,
      expiresAt: invites.expiresAt,
    })
    .from(invites)
    .leftJoin(branches, eq(branches.id, invites.branchId))
    .where(
      and(
        eq(invites.tokenHash, hashInviteToken(token)),
        // Одноразове: використане запрошення більше не знаходиться.
        isNull(invites.acceptedAt),
        sql`${invites.expiresAt} > now()`,
      ),
    );
  return row ?? null;
}

const REJECTED: InviteCheckDto = {
  email: "",
  role: "manager",
  branchName: "",
  // Одне формулювання на всі випадки — підроблений токен, прострочений і вже
  // використаний. Різні тексти підказували б, який саме токен «майже вгадано».
  error: "Запрошення недійсне або вже використане",
};

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const invite = await findInvite(token);
    if (!invite) return Response.json(REJECTED, { status: 404 });

    return Response.json({
      email: invite.email,
      role: invite.role,
      branchName: invite.branchName ?? "",
    } satisfies InviteCheckDto);
  } catch {
    return Response.json(
      { ...REJECTED, error: "PostgreSQL error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const parsed = registerRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const body = parsed.data;
    const db = getDb();
    const invite = await findInvite(body.token);
    if (!invite) return Response.json(REJECTED, { status: 404 });

    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, invite.email));
    if (taken)
      return Response.json(
        { error: "Обліковий запис із цією поштою вже існує" },
        { status: 409 },
      );

    const passwordHash = await bcrypt.hash(body.password, 12);

    await db.transaction(async (tx) => {
      // Позначаємо прийнятим за тією ж умовою, за якою шукали: якщо два запити
      // з одним посиланням прийшли одночасно, другий оновить нуль рядків і
      // облікового запису не створить.
      const claimed = await tx
        .update(invites)
        .set({ acceptedAt: new Date() })
        .where(and(eq(invites.id, invite.id), isNull(invites.acceptedAt)))
        .returning({ id: invites.id });
      if (!claimed.length) throw new Error("INVITE_ALREADY_USED");

      await tx.insert(users).values({
        email: invite.email,
        passwordHash,
        name: body.name,
        role: invite.role,
        // Садочок береться із запрошення разом із роллю. Без нього обліковий
        // запис створювався б «нічийним» і не проходив би resolveScope().
        kindergartenId: invite.kindergartenId,
        branchId: invite.branchId,
      });
    });

    // Пароль назад не повертаємо — сторінка входить сама, тим, що ввела людина.
    return Response.json({ email: invite.email });
  } catch (error) {
    if (error instanceof Error && error.message === "INVITE_ALREADY_USED")
      return Response.json(REJECTED, { status: 409 });
    return Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}
