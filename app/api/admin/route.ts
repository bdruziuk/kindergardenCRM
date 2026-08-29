import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { getServerSession } from "next-auth";
import { getDb } from "@/db";
import {
  branches,
  children,
  groups,
  invites,
  kindergartens,
  staff,
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
import { plural } from "@/lib/format";
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

/** Скільки рядків таблиці посилається на цю філію, вже підписаних відмінком. */
async function countRows(
  table: PgTable,
  column: PgColumn,
  branchId: number,
  forms: [string, string, string],
) {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(column, branchId));
  const count = row?.count ?? 0;
  return { count, label: `${count} ${plural(count, ...forms)}` };
}

async function snapshot(newInviteUrl?: string): Promise<AdminSnapshot> {
  const db = getDb();

  const [
    gardenRows,
    branchRows,
    groupCounts,
    childCounts,
    allChildCounts,
    staffCounts,
    transactionCounts,
    waitlistCounts,
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
    // Що тримає філію від видалення. Діти тут рахуються **всі**, включно з
    // вибулими: у лічильнику вгорі вони не показані, але запис лишається й
    // видалити філію під ним не можна.
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
        branchId: transactions.branchId,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .groupBy(transactions.branchId),
    db
      .select({
        branchId: waitlist.branchId,
        count: sql<number>`count(*)::int`,
      })
      .from(waitlist)
      .groupBy(waitlist.branchId),
    db
      .select({
        id: users.id,
        kindergartenId: users.kindergartenId,
        name: users.name,
        email: users.email,
        role: users.role,
        branchId: users.branchId,
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
      removable:
        countFor(groupCounts, branch.id) === 0 &&
        countFor(allChildCounts, branch.id) === 0 &&
        countFor(staffCounts, branch.id) === 0 &&
        countFor(transactionCounts, branch.id) === 0 &&
        countFor(waitlistCounts, branch.id) === 0,
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
        children: branchDtos.reduce((sum, b) => sum + b.children, 0),
        people: people.length,
      },
      // Порожній садочок: ні філій, ні людей. Запрошення не рахуємо — вони
      // зникнуть разом із ним каскадом і нічого цінного не тримають.
      removable: branchDtos.length === 0 && people.length === 0,
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

      await db.insert(kindergartens).values({ name: body.name });
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

      await db.insert(branches).values({
        kindergartenId: body.kindergartenId,
        name: body.name,
        address: body.address || null,
        monthlyFee: body.monthlyFee,
      });
    } else if (body.kind === "branch_delete") {
      // Видаляємо лише порожню філію. Каскад тут знищив би дітей, персонал і
      // гроші одним кліком, а в системі з даними дітей така кнопка не має
      // права існувати — тому спершу перелічуємо, що саме тримає.
      const blocking = await Promise.all([
        countRows(children, children.branchId, body.branchId, [
          "дитина",
          "дитини",
          "дітей",
        ]),
        countRows(groups, groups.branchId, body.branchId, [
          "група",
          "групи",
          "груп",
        ]),
        countRows(staff, staff.branchId, body.branchId, [
          "працівник",
          "працівники",
          "працівників",
        ]),
        countRows(transactions, transactions.branchId, body.branchId, [
          "операція",
          "операції",
          "операцій",
        ]),
        countRows(waitlist, waitlist.branchId, body.branchId, [
          "заявка",
          "заявки",
          "заявок",
        ]),
      ]);
      const held = blocking.filter((item) => item.count > 0);
      if (held.length)
        throw new ScopeError(
          `Філія не порожня: ${held
            .map((item) => item.label)
            .join(", ")}. Спершу приберіть ці записи.`,
          409,
        );

      await db.delete(branches).where(eq(branches.id, body.branchId));
    } else {
      const [branchCount, userCount] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(branches)
          .where(eq(branches.kindergartenId, body.kindergartenId)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(eq(users.kindergartenId, body.kindergartenId)),
      ]);
      const branchesLeft = branchCount[0]?.count ?? 0;
      const usersLeft = userCount[0]?.count ?? 0;
      const held = [
        branchesLeft
          ? `${branchesLeft} ${plural(branchesLeft, "філія", "філії", "філій")}`
          : "",
        usersLeft
          ? `${usersLeft} ${plural(usersLeft, "обліковий запис", "облікові записи", "облікових записів")}`
          : "",
      ].filter(Boolean);
      if (held.length)
        throw new ScopeError(
          `Садочок не порожній: ${held.join(", ")}. Спершу приберіть їх.`,
          409,
        );

      // Невикористані запрошення підуть каскадом — вони нічого не тримають.
      await db
        .delete(kindergartens)
        .where(eq(kindergartens.id, body.kindergartenId));
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
