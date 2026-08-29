import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { getDb } from "@/db";
import { branches, invites, kindergartens, users } from "@/db/schema";
import {
  type AccountDto,
  type BranchSettingsDto,
  type InviteDto,
  type SettingsSnapshot,
  firstIssue,
  settingsRequest,
} from "@/lib/api-schemas";
import { authOptions } from "@/lib/auth";
import { ScopeError, scopeFailure } from "@/lib/scope";
import {
  hashInviteToken,
  inviteUrl,
  newInviteToken,
  publicOrigin,
} from "@/lib/invites";
import { DEFAULT_THEME } from "@/lib/theme";

/**
 * Хто дивиться. Роль і філію беремо з бази, а не з токена: їх могли змінити на
 * сторінці «Філії» вже після входу, і токен про це ще не знає.
 */
async function viewer() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new ScopeError("Потрібна авторизація", 401);

  const [row] = await getDb()
    .select({
      id: users.id,
      role: users.role,
      branchId: users.branchId,
      kindergartenId: users.kindergartenId,
    })
    .from(users)
    .where(eq(users.id, Number(session.user.id)));
  if (!row) throw new ScopeError("Користувача не знайдено", 401);
  // Супер-адміністратор не належить садочку — його налаштування живуть у
  // кабінеті, а тут йому нема чого показувати.
  if (row.role === "superadmin")
    throw new ScopeError("Супер-адміністратор працює в кабінеті", 403);
  if (!row.kindergartenId)
    throw new ScopeError("Вам не призначено садочок", 403);
  return {
    ...row,
    kindergartenId: row.kindergartenId,
    isOwner: row.role === "admin",
  };
}

type Viewer = Awaited<ReturnType<typeof viewer>>;

async function snapshot(
  me: Viewer,
  newInviteUrl?: string,
): Promise<SettingsSnapshot> {
  const db = getDb();
  const [userRows, branchRows, gardenRows, inviteRows] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        branchId: users.branchId,
        theme: users.theme,
      })
      .from(users)
      .where(eq(users.kindergartenId, me.kindergartenId))
      .orderBy(asc(users.id)),
    db
      .select({
        id: branches.id,
        name: branches.name,
        address: branches.address,
        theme: branches.theme,
        themeByOwner: branches.themeByOwner,
      })
      .from(branches)
      .where(eq(branches.kindergartenId, me.kindergartenId))
      .orderBy(asc(branches.id)),
    db
      .select({ name: kindergartens.name })
      .from(kindergartens)
      .where(eq(kindergartens.id, me.kindergartenId)),
    // Запрошення бачить лише власник, тож керуючому їх навіть не читаємо.
    me.isOwner
      ? db
          .select({
            id: invites.id,
            email: invites.email,
            role: invites.role,
            branchId: invites.branchId,
            expiresAt: invites.expiresAt,
            acceptedAt: invites.acceptedAt,
          })
          .from(invites)
          .where(
            and(
              eq(invites.kindergartenId, me.kindergartenId),
              // Запрошення власникам роздає супер-адміністратор зі свого
              // кабінету — власнику ні до чого бачити в своїй панелі чужу
              // дію, зокрема те, за яким прийшов він сам.
              ne(invites.role, "admin"),
            ),
          )
          .orderBy(desc(invites.createdAt))
      : Promise.resolve([]),
  ]);

  const toAccount = (row: (typeof userRows)[number]): AccountDto => ({
    id: row.id,
    name: row.name ?? "",
    email: row.email,
    role: row.role,
    branchName:
      branchRows.find((branch) => branch.id === row.branchId)?.name ?? "",
  });

  const self = userRows.find((row) => row.id === me.id);
  if (!self) throw new ScopeError("Користувача не знайдено", 401);

  // Керуючий налаштовує лише свою філію, тож чужі до нього не їдуть узагалі.
  const visibleBranches = me.isOwner
    ? branchRows
    : branchRows.filter((branch) => branch.id === me.branchId);

  const branchDtos: BranchSettingsDto[] = visibleBranches.map((branch) => ({
    id: branch.id,
    name: branch.name,
    address: branch.address ?? "",
    theme: branch.theme,
    lockedByOwner: branch.themeByOwner,
    // Схему філії керуючий міняє, лише поки її не зайняв власник.
    canEditTheme: me.isOwner || !branch.themeByOwner,
    canEditDetails: me.isOwner,
  }));

  const now = Date.now();
  const inviteDtos: InviteDto[] = inviteRows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    branchName:
      branchRows.find((branch) => branch.id === row.branchId)?.name ?? "",
    expiresAt: row.expiresAt.toISOString(),
    status: row.acceptedAt
      ? "accepted"
      : row.expiresAt.getTime() <= now
        ? "expired"
        : "waiting",
  }));

  return {
    me: toAccount(self),
    kindergartenName: gardenRows[0]?.name ?? "",
    others: me.isOwner
      ? userRows.filter((row) => row.id !== me.id).map(toAccount)
      : [],
    personalTheme: me.isOwner ? (self.theme ?? null) : null,
    activeTheme:
      self.theme ??
      branchRows.find((branch) => branch.id === self.branchId)?.theme ??
      DEFAULT_THEME,
    branches: branchDtos,
    invites: inviteDtos,
    ...(newInviteUrl ? { newInviteUrl } : {}),
  };
}

export async function GET() {
  try {
    const me = await viewer();
    return Response.json(await snapshot(me));
  } catch (error) {
    return (
      scopeFailure(error) ??
      Response.json(
        { error: error instanceof Error ? error.message : "PostgreSQL error" },
        { status: 500 },
      )
    );
  }
}

export async function POST(request: Request) {
  try {
    const me = await viewer();
    const parsed = settingsRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const db = getDb();
    const body = parsed.data;

    if (body.kind === "invite_create") {
      if (!me.isOwner)
        throw new ScopeError("Запрошення видає лише власник", 403);

      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, body.email));
      if (taken)
        throw new ScopeError("Такий обліковий запис уже існує", 409);

      const [branch] = await db
        .select({ id: branches.id })
        .from(branches)
        .where(
          and(
            eq(branches.id, body.branchId),
            eq(branches.kindergartenId, me.kindergartenId),
          ),
        );
      if (!branch) throw new ScopeError("Немає доступу до цієї філії", 403);

      // Чинні запрошення на ту саму пошту скасовуємо: два робочі посилання на
      // одну людину — це просто зайвий ключ, який десь лишиться.
      await db
        .delete(invites)
        .where(and(eq(invites.email, body.email), isNull(invites.acceptedAt)));

      const token = newInviteToken();
      await db.insert(invites).values({
        tokenHash: hashInviteToken(token),
        email: body.email,
        // Роль не приходить із запиту: власник запрошує лише керуючих, а
        // власника заводить супер-адміністратор у кабінеті. Взяти її з тіла
        // означало б дозволити підмінити.
        role: "manager",
        kindergartenId: me.kindergartenId,
        branchId: body.branchId,
        invitedBy: me.id,
        expiresAt: sql`now() + make_interval(days => ${body.days})`,
      });

      const origin = publicOrigin(request);
      return Response.json(await snapshot(me, inviteUrl(origin, token)));
    } else if (body.kind === "invite_revoke") {
      if (!me.isOwner)
        throw new ScopeError("Запрошення скасовує лише власник", 403);
      // Прийняті не чіпаємо: це вже слід у журналі, а не діючий ключ.
      await db
        .delete(invites)
        .where(
          and(
            eq(invites.id, body.inviteId),
            eq(invites.kindergartenId, me.kindergartenId),
            isNull(invites.acceptedAt),
          ),
        );
    } else if (body.kind === "name") {
      // Чуже ПІБ міняє тільки власник; спроба керуючого — помилка, а не тиха
      // підміна на власний запис, щоб хиба в інтерфейсі не лишилась непоміченою.
      if (!me.isOwner && body.userId !== me.id)
        throw new ScopeError("Можна змінювати лише власний профіль", 403);
      await db
        .update(users)
        .set({ name: body.name })
        .where(eq(users.id, body.userId));
    } else if (body.kind === "personal_theme") {
      // Особиста схема є тільки у власника: керуючий міняє схему своєї філії.
      if (!me.isOwner)
        throw new ScopeError("Особисту схему налаштовує лише власник", 403);
      await db
        .update(users)
        .set({ theme: body.theme })
        .where(eq(users.id, me.id));
    } else if (body.kind === "kindergarten_rename") {
      if (!me.isOwner)
        throw new ScopeError("Назву садочка змінює лише власник", 403);

      // Назви садочків унікальні глобально, тож зіткнення ловимо самі —
      // інакше воно прилетіло б із бази п'ятисоткою.
      const [clash] = await db
        .select({ id: kindergartens.id })
        .from(kindergartens)
        .where(
          and(
            eq(kindergartens.name, body.name),
            ne(kindergartens.id, me.kindergartenId),
          ),
        );
      if (clash) throw new ScopeError("Садочок із такою назвою вже є", 409);

      await db
        .update(kindergartens)
        .set({ name: body.name })
        .where(eq(kindergartens.id, me.kindergartenId));
    } else if (body.kind === "branch_theme") {
      if (!me.isOwner) {
        if (body.branchId !== me.branchId)
          throw new ScopeError("Немає доступу до цієї філії", 403);

        const [branch] = await db
          .select({ themeByOwner: branches.themeByOwner })
          .from(branches)
          .where(eq(branches.id, body.branchId));
        if (branch?.themeByOwner)
          throw new ScopeError(
            "Схему цієї філії встановив власник — змінити її не можна",
            403,
          );
      }
      await db
        .update(branches)
        .set({
          theme: body.theme,
          // Скидання схеми знімає й замок: філія знову вільна для керуючого.
          themeByOwner: me.isOwner && body.theme !== null,
        })
        .where(
          and(
            eq(branches.id, body.branchId),
            eq(branches.kindergartenId, me.kindergartenId),
          ),
        );
    } else {
      if (!me.isOwner)
        throw new ScopeError("Філії редагує лише власник", 403);
      await db
        .update(branches)
        .set({ name: body.name, address: body.address || null })
        .where(
          and(
            eq(branches.id, body.branchId),
            eq(branches.kindergartenId, me.kindergartenId),
          ),
        );
    }

    return Response.json(await snapshot(me));
  } catch (error) {
    return (
      scopeFailure(error) ??
      Response.json(
        { error: error instanceof Error ? error.message : "PostgreSQL error" },
        { status: 500 },
      )
    );
  }
}
