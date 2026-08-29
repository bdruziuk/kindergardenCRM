import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { getDb } from "@/db";
import {
  ageCategories,
  branches,
  children,
  groups,
  invites,
  jobTitles,
  kindergartens,
  lessons,
  payments,
  relatives,
  salaryPayments,
  staff,
  staffAttendance,
  transactions,
  users,
  waitlist,
} from "@/db/schema";
import {
  type AdminBranchDto,
  type AdminKindergartenDto,
  type AdminPersonDto,
  type AdminSnapshot,
  adminRequest,
  firstIssue,
} from "@/lib/api-schemas";
import { authOptions } from "@/lib/auth";
import {
  hashInviteToken,
  inviteUrl,
  newInviteToken,
  publicOrigin,
} from "@/lib/invites";
import { ScopeError, scopeFailure } from "@/lib/scope";

/**
 * Кабінет супер-адміністратора: реєстр садочків.
 *
 * Це єдине місце, яке дивиться понад межею садочка, тому роль перевіряється
 * тут, а не десь у спільному хелпері — щоб її неможливо було випадково
 * успадкувати разом із чимось іншим. Роль беремо з бази, а не з токена: її
 * могли змінити вже після входу.
 */
async function requireSuperadmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new ScopeError("Потрібна авторизація", 401);

  const [row] = await getDb()
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, Number(session.user.id)));
  if (!row) throw new ScopeError("Користувача не знайдено", 401);
  if (row.role !== "superadmin")
    throw new ScopeError("Доступно лише супер-адміністратору", 403);
  return row;
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Зносить філії разом з усім, що на них тримається.
 *
 * Порядок тут не косметичний: спершу йде те, що посилається на дітей і
 * персонал, потім самі діти й персонал, і аж тоді філії. Частина зв'язків має
 * `on delete cascade` і прибралася б сама, але покладатися на це означало б,
 * що зміна однієї властивості в схемі мовчки змінює поведінку видалення —
 * тому кожна таблиця названа явно.
 */
async function purgeBranches(tx: Tx, branchIds: number[]) {
  if (!branchIds.length) return;

  const childIds = (
    await tx
      .select({ id: children.id })
      .from(children)
      .where(inArray(children.branchId, branchIds))
  ).map((row) => row.id);
  const staffIds = (
    await tx
      .select({ id: staff.id })
      .from(staff)
      .where(inArray(staff.branchId, branchIds))
  ).map((row) => row.id);

  if (childIds.length) {
    await tx.delete(payments).where(inArray(payments.childId, childIds));
    await tx.delete(relatives).where(inArray(relatives.childId, childIds));
  }
  if (staffIds.length) {
    await tx
      .delete(staffAttendance)
      .where(inArray(staffAttendance.staffId, staffIds));
    await tx.delete(lessons).where(inArray(lessons.staffId, staffIds));
    await tx
      .delete(salaryPayments)
      .where(inArray(salaryPayments.staffId, staffIds));
  }

  await tx.delete(children).where(inArray(children.branchId, branchIds));
  await tx.delete(staff).where(inArray(staff.branchId, branchIds));
  await tx
    .delete(transactions)
    .where(inArray(transactions.branchId, branchIds));
  await tx.delete(waitlist).where(inArray(waitlist.branchId, branchIds));
  await tx
    .delete(ageCategories)
    .where(inArray(ageCategories.branchId, branchIds));
  await tx.delete(groups).where(inArray(groups.branchId, branchIds));
  await tx.delete(invites).where(inArray(invites.branchId, branchIds));

  // Керуючих цих філій відв'язуємо, а не видаляємо: філію можуть зносити
  // окремо від садочка, і людина має лишитися при своєму записі.
  await tx
    .update(users)
    .set({ branchId: null })
    .where(inArray(users.branchId, branchIds));

  await tx.delete(branches).where(inArray(branches.id, branchIds));
}

/** Посади, з якими садочок починає життя — той самий набір, що колись був
 *  зашитий у сторінку «Колектив». Далі власник править їх у себе. */
const STARTER_TITLES = [
  "Вихователь",
  "Помічник вихователя",
  "Вчитель",
  "Кухар",
  "Помічник кухаря",
];

async function snapshot(newInviteUrl?: string): Promise<AdminSnapshot> {
  const db = getDb();

  const [
    gardenRows,
    branchRows,
    groupCounts,
    childCounts,
    allChildCounts,
    staffCounts,
    peopleRows,
    inviteRows,
  ] = await Promise.all([
    db
      .select({
        id: kindergartens.id,
        name: kindergartens.name,
        createdAt: kindergartens.createdAt,
      })
      .from(kindergartens)
      .orderBy(asc(kindergartens.id)),
    db
      .select({
        id: branches.id,
        kindergartenId: branches.kindergartenId,
        name: branches.name,
        address: branches.address,
      })
      .from(branches)
      .orderBy(asc(branches.id)),
    // Групи й діти рахуються окремими згрупованими запитами й зшиваються в JS.
    // Join одразу по двох гілках перемножив би рядки й роздув обидва числа, а
    // кореляційний підзапит через `sql` рендериться без префіксів таблиць —
    // `where "branch_id" = "id"` всередині підзапиту вказує сам на себе.
    db
      .select({
        branchId: groups.branchId,
        count: sql<number>`count(*)::int`,
      })
      .from(groups)
      .groupBy(groups.branchId),
    db
      .select({
        branchId: children.branchId,
        count: sql<number>`count(*)::int`,
      })
      .from(children)
      .where(ne(children.status, "left"))
      .groupBy(children.branchId),
    // Діти тут рахуються **всі**, включно з вибулими: у лічильнику вгорі їх
    // не видно, але при видаленні зникнуть і вони, тож попередження має
    // називати справжнє число.
    db
      .select({
        branchId: children.branchId,
        count: sql<number>`count(*)::int`,
      })
      .from(children)
      .groupBy(children.branchId),
    db
      .select({
        branchId: staff.branchId,
        count: sql<number>`count(*)::int`,
      })
      .from(staff)
      .groupBy(staff.branchId),
    db
      .select({
        id: users.id,
        kindergartenId: users.kindergartenId,
        name: users.name,
        email: users.email,
        role: users.role,
        branchId: users.branchId,
        avatar: users.avatar,
      })
      .from(users)
      .where(ne(users.role, "superadmin"))
      .orderBy(asc(users.id)),
    db
      .select({
        id: invites.id,
        kindergartenId: invites.kindergartenId,
        email: invites.email,
        role: invites.role,
        expiresAt: invites.expiresAt,
        acceptedAt: invites.acceptedAt,
      })
      .from(invites)
      .where(eq(invites.role, "admin"))
      .orderBy(desc(invites.createdAt)),
  ]);

  const now = Date.now();

  const list: AdminKindergartenDto[] = gardenRows.map((garden) => {
    const own = branchRows.filter((b) => b.kindergartenId === garden.id);
    const people = peopleRows.filter((p) => p.kindergartenId === garden.id);

    const toPerson = (person: (typeof peopleRows)[number]): AdminPersonDto => ({
      id: person.id,
      hasAvatar: Boolean(person.avatar),
      name: person.name ?? "",
      email: person.email,
      role: person.role,
      branchName: own.find((b) => b.id === person.branchId)?.name ?? "",
    });

    const countFor = (
      rows: { branchId: number; count: number }[],
      branchId: number,
    ) => rows.find((row) => row.branchId === branchId)?.count ?? 0;

    const branchDtos: AdminBranchDto[] = own.map((branch) => ({
      id: branch.id,
      name: branch.name,
      address: branch.address ?? "",
      groups: countFor(groupCounts, branch.id),
      children: countFor(childCounts, branch.id),
      childrenTotal: countFor(allChildCounts, branch.id),
      staff: countFor(staffCounts, branch.id),
    }));

    return {
      id: garden.id,
      name: garden.name,
      createdAt: garden.createdAt.toISOString().slice(0, 10),
      branches: branchDtos,
      owners: people.filter((p) => p.role === "admin").map(toPerson),
      managers: people
        .filter((p) => p.role !== "admin")
        .map(toPerson),
      totals: {
        branches: branchDtos.length,
        groups: branchDtos.reduce((sum, b) => sum + b.groups, 0),
        children: branchDtos.reduce((sum, b) => sum + b.childrenTotal, 0),
        staff: branchDtos.reduce((sum, b) => sum + b.staff, 0),
        people: people.length,
      },
      invites: inviteRows
        .filter((row) => row.kindergartenId === garden.id)
        .map((row) => ({
          id: row.id,
          email: row.email,
          role: row.role,
          branchName: "",
          expiresAt: row.expiresAt.toISOString(),
          status: row.acceptedAt
            ? ("accepted" as const)
            : row.expiresAt.getTime() <= now
              ? ("expired" as const)
              : ("waiting" as const),
        })),
    };
  });

  return {
    kindergartens: list,
    totals: {
      kindergartens: list.length,
      branches: branchRows.length,
      groups: list.reduce((sum, g) => sum + g.totals.groups, 0),
      children: list.reduce((sum, g) => sum + g.totals.children, 0),
    },
    ...(newInviteUrl ? { newInviteUrl } : {}),
  };
}

export async function GET() {
  try {
    await requireSuperadmin();
    return Response.json(await snapshot());
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
    const me = await requireSuperadmin();
    const parsed = adminRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const db = getDb();
    const body = parsed.data;

    if (body.kind === "kindergarten_create") {
      const [existing] = await db
        .select({ id: kindergartens.id })
        .from(kindergartens)
        .where(eq(kindergartens.name, body.name));
      if (existing)
        throw new ScopeError("Садочок із такою назвою вже є", 409);

      const [created] = await db
        .insert(kindergartens)
        .values({ name: body.name })
        .returning({ id: kindergartens.id });
      // Без цього власник відкрив би налаштування з порожньою бібліотекою.
      await db.insert(jobTitles).values(
        STARTER_TITLES.map((name) => ({
          kindergartenId: created.id,
          name,
        })),
      );
    } else if (body.kind === "kindergarten_rename") {
      const [clash] = await db
        .select({ id: kindergartens.id })
        .from(kindergartens)
        .where(
          and(
            eq(kindergartens.name, body.name),
            ne(kindergartens.id, body.kindergartenId),
          ),
        );
      if (clash) throw new ScopeError("Садочок із такою назвою вже є", 409);

      await db
        .update(kindergartens)
        .set({ name: body.name })
        .where(eq(kindergartens.id, body.kindergartenId));
    } else if (body.kind === "owner_invite") {
      const [garden] = await db
        .select({ id: kindergartens.id })
        .from(kindergartens)
        .where(eq(kindergartens.id, body.kindergartenId));
      if (!garden) throw new ScopeError("Садочок не знайдено", 404);

      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, body.email));
      if (taken) throw new ScopeError("Такий обліковий запис уже існує", 409);

      // Чинні запрошення на ту саму пошту скасовуємо: два робочі посилання на
      // одну людину — зайвий ключ, який десь лишиться.
      await db
        .delete(invites)
        .where(and(eq(invites.email, body.email), isNull(invites.acceptedAt)));

      const token = newInviteToken();
      await db.insert(invites).values({
        tokenHash: hashInviteToken(token),
        email: body.email,
        role: "admin",
        kindergartenId: body.kindergartenId,
        branchId: null,
        invitedBy: me.id,
        expiresAt: sql`now() + make_interval(days => ${body.days})`,
      });

      const origin = publicOrigin(request);
      return Response.json(await snapshot(inviteUrl(origin, token)));
    } else if (body.kind === "admin_invite_revoke") {
      await db
        .delete(invites)
        .where(and(eq(invites.id, body.inviteId), isNull(invites.acceptedAt)));
    } else if (body.kind === "branch_create") {
      const [garden] = await db
        .select({ id: kindergartens.id })
        .from(kindergartens)
        .where(eq(kindergartens.id, body.kindergartenId));
      if (!garden) throw new ScopeError("Садочок не знайдено", 404);

      const [clash] = await db
        .select({ id: branches.id })
        .from(branches)
        .where(
          and(
            eq(branches.kindergartenId, body.kindergartenId),
            eq(branches.name, body.name),
          ),
        );
      if (clash)
        throw new ScopeError("У цьому садочку вже є філія з такою назвою", 409);

      const [branch] = await db
        .insert(branches)
        .values({
          kindergartenId: body.kindergartenId,
          name: body.name,
          address: body.address || null,
          monthlyFee: body.monthlyFee,
        })
        .returning({ id: branches.id });

      // Нова філія переймає бібліотеку садочка: інакше в керуючого була б
      // порожня випадайка посад і жодного способу її наповнити.
      const library = await db
        .select({ name: jobTitles.name })
        .from(jobTitles)
        .where(
          and(
            eq(jobTitles.kindergartenId, body.kindergartenId),
            isNull(jobTitles.branchId),
          ),
        );
      if (library.length)
        await db.insert(jobTitles).values(
          library.map((title) => ({
            kindergartenId: body.kindergartenId,
            branchId: branch.id,
            name: title.name,
          })),
        );
    } else if (body.kind === "branch_delete") {
      const [branch] = await db
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.id, body.branchId));
      if (!branch) throw new ScopeError("Філію не знайдено", 404);

      await db.transaction((tx) => purgeBranches(tx, [body.branchId]));
    } else {
      const [garden] = await db
        .select({ id: kindergartens.id })
        .from(kindergartens)
        .where(eq(kindergartens.id, body.kindergartenId));
      if (!garden) throw new ScopeError("Садочок не знайдено", 404);

      const branchIds = (
        await db
          .select({ id: branches.id })
          .from(branches)
          .where(eq(branches.kindergartenId, body.kindergartenId))
      ).map((row) => row.id);

      await db.transaction(async (tx) => {
        await purgeBranches(tx, branchIds);
        // Супер-адміністратора це не зачепить: він не належить жодному
        // садочку, тож у цю вибірку не потрапляє.
        await tx
          .delete(users)
          .where(eq(users.kindergartenId, body.kindergartenId));
        await tx
          .delete(invites)
          .where(eq(invites.kindergartenId, body.kindergartenId));
        await tx
          .delete(kindergartens)
          .where(eq(kindergartens.id, body.kindergartenId));
      });
    }

    return Response.json(await snapshot());
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
