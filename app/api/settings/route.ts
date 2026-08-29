import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { getDb } from "@/db";
import {
  branches,
  invites,
  jobTitles,
  kindergartens,
  users,
} from "@/db/schema";
import {
  type AccountDto,
  type BranchSettingsDto,
  type InviteDto,
  type JobTitleDto,
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
import { passwordLetter, sendMail } from "@/lib/mailer";
import {
  RESET_TTL_HOURS,
  issueResetToken,
  resetUrl,
} from "@/lib/password-reset";
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

/** Філія має належати садочку того, хто дивиться, а керуючому — бути його
 *  власною. Без цього посаду можна було б підкинути в чужу філію. */
async function assertBranch(
  db: ReturnType<typeof getDb>,
  me: Viewer,
  branchId: number,
) {
  if (!me.isOwner && branchId !== me.branchId)
    throw new ScopeError("Немає доступу до цієї філії", 403);

  const [branch] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(
      and(
        eq(branches.id, branchId),
        eq(branches.kindergartenId, me.kindergartenId),
      ),
    );
  if (!branch) throw new ScopeError("Немає доступу до цієї філії", 403);
}

async function snapshot(
  me: Viewer,
  extra?: { newInviteUrl?: string; passwordMail?: "sent" | "logged" },
): Promise<SettingsSnapshot> {
  const db = getDb();
  const [userRows, branchRows, gardenRows, titleRows, inviteRows] =
    await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        branchId: users.branchId,
        theme: users.theme,
        avatar: users.avatar,
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
    db
      .select({
        id: jobTitles.id,
        name: jobTitles.name,
        branchId: jobTitles.branchId,
        addedByOwner: jobTitles.addedByOwner,
        salaryType: jobTitles.salaryType,
        rate: jobTitles.rate,
        vacationQuota: jobTitles.vacationQuota,
        dayOffQuota: jobTitles.dayOffQuota,
      })
      .from(jobTitles)
      .where(eq(jobTitles.kindergartenId, me.kindergartenId))
      .orderBy(asc(jobTitles.id)),
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

  /** `branchId` розрізняє бібліотеку й філію лише всередині знімка, назовні
   *  він не потрібен — тому збираємо DTO явно, а не відкиданням поля. */
  const toTitle = (row: (typeof titleRows)[number]): JobTitleDto => ({
    id: row.id,
    name: row.name,
    addedByOwner: row.addedByOwner,
    salaryType: row.salaryType,
    rate: row.rate,
    vacationQuota: row.vacationQuota,
    dayOffQuota: row.dayOffQuota,
  });

  const toAccount = (row: (typeof userRows)[number]): AccountDto => ({
    id: row.id,
    hasAvatar: Boolean(row.avatar),
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
    jobTitles: titleRows
      .filter((row) => row.branchId === branch.id)
      .map(toTitle),
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

  const library: JobTitleDto[] = me.isOwner
    ? titleRows
        .filter((row) => row.branchId === null)
        .map(toTitle)
    : [];

  return {
    me: toAccount(self),
    kindergartenName: gardenRows[0]?.name ?? "",
    jobTitles: library,
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
    ...extra,
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
      return Response.json(
        await snapshot(me, { newInviteUrl: inviteUrl(origin, token) }),
      );
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
    } else if (body.kind === "avatar_set") {
      // Тільки свою: чужий знімок ставити не має права навіть власник.
      const match = body.dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
      if (!match) throw new ScopeError("Некоректне зображення", 400);
      const [, meta, data] = match;
      await db
        .update(users)
        .set({ avatar: data, avatarMime: meta })
        .where(eq(users.id, me.id));
    } else if (body.kind === "job_title_add") {
      if (body.branchId === null) {
        // Бібліотека — власникова: керуючому нема чого розкладати по чужих
        // філіях, у нього є своя.
        if (!me.isOwner)
          throw new ScopeError("Бібліотеку посад веде власник", 403);
        await db
          .insert(jobTitles)
          .values({ kindergartenId: me.kindergartenId, name: body.name })
          .onConflictDoNothing();
      } else {
        await assertBranch(db, me, body.branchId);
        await db
          .insert(jobTitles)
          .values({
            kindergartenId: me.kindergartenId,
            branchId: body.branchId,
            name: body.name,
            addedByOwner: me.isOwner,
          })
          .onConflictDoNothing();
      }
    } else if (body.kind === "job_title_update") {
      const [title] = await db
        .select({ id: jobTitles.id, branchId: jobTitles.branchId })
        .from(jobTitles)
        .where(
          and(
            eq(jobTitles.id, body.titleId),
            eq(jobTitles.kindergartenId, me.kindergartenId),
          ),
        );
      if (!title) throw new ScopeError("Посаду не знайдено", 404);

      if (!me.isOwner) {
        if (title.branchId === null)
          throw new ScopeError("Бібліотеку посад веде власник", 403);
        // Ставки правити керуючому можна навіть у спущеній власником посаді:
        // саме заради цього посада й прив'язана до філії — в іншій вони інші.
        // Під замком лишається тільки видалення.
        await assertBranch(db, me, title.branchId);
      }

      await db
        .update(jobTitles)
        .set({
          salaryType: body.salaryType,
          rate: body.rate,
          vacationQuota: body.vacationQuota,
          dayOffQuota: body.dayOffQuota,
        })
        .where(eq(jobTitles.id, body.titleId));
    } else if (body.kind === "job_title_remove") {
      const [title] = await db
        .select({
          id: jobTitles.id,
          branchId: jobTitles.branchId,
          addedByOwner: jobTitles.addedByOwner,
        })
        .from(jobTitles)
        .where(
          and(
            eq(jobTitles.id, body.titleId),
            eq(jobTitles.kindergartenId, me.kindergartenId),
          ),
        );
      if (!title) throw new ScopeError("Посаду не знайдено", 404);

      if (!me.isOwner) {
        if (title.branchId === null)
          throw new ScopeError("Бібліотеку посад веде власник", 403);
        await assertBranch(db, me, title.branchId);
        // Ту саму межу, що й у кольорових схемах: своє прибирає, спущене
        // власником — ні.
        if (title.addedByOwner)
          throw new ScopeError("Цю посаду додав власник", 403);
      }

      await db.delete(jobTitles).where(eq(jobTitles.id, body.titleId));
    } else if (body.kind === "job_titles_apply") {
      if (!me.isOwner)
        throw new ScopeError("Бібліотеку розкладає власник", 403);
      await assertBranch(db, me, body.branchId);

      const library = await db
        .select({ name: jobTitles.name })
        .from(jobTitles)
        .where(
          and(
            eq(jobTitles.kindergartenId, me.kindergartenId),
            isNull(jobTitles.branchId),
          ),
        );
      if (library.length)
        await db
          .insert(jobTitles)
          .values(
            library.map((title) => ({
              kindergartenId: me.kindergartenId,
              branchId: body.branchId,
              name: title.name,
              addedByOwner: true,
            })),
          )
          // Наявні у філії лишаємо як є: «застосувати» доповнює, а не
          // затирає те, що керуючий додав собі сам.
          .onConflictDoNothing();
    } else if (body.kind === "avatar_clear") {
      await db
        .update(users)
        .set({ avatar: null, avatarMime: null })
        .where(eq(users.id, me.id));
    } else if (body.kind === "password_change_request") {
      // Пароль змінюється тільки через пошту — так само, як при «забули
      // пароль». Форма зі старим і новим паролем була б простішою, але тоді
      // зміна залежала б від того, хто зараз за клавіатурою, а не від доступу
      // до скриньки.
      const [self] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, me.id));
      if (!self) throw new ScopeError("Користувача не знайдено", 401);

      const token = await issueResetToken(me.id);
      const link = resetUrl(publicOrigin(request), token);
      const passwordMail = await sendMail({
        to: self.email,
        ...passwordLetter(link, RESET_TTL_HOURS, false),
      });

      return Response.json(await snapshot(me, { passwordMail }));
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
