import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { getDb } from "@/db";
import {
  branches,
  children,
  groups,
  invites,
  kindergartens,
  users,
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
import { hashInviteToken, inviteUrl, newInviteToken } from "@/lib/invites";
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

async function snapshot(newInviteUrl?: string): Promise<AdminSnapshot> {
  const db = getDb();

  const [
    gardenRows,
    branchRows,
    groupCounts,
    childCounts,
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

    const branchDtos: AdminBranchDto[] = own.map((branch) => ({
      id: branch.id,
      name: branch.name,
      address: branch.address ?? "",
      groups: groupCounts.find((row) => row.branchId === branch.id)?.count ?? 0,
      children:
        childCounts.find((row) => row.branchId === branch.id)?.count ?? 0,
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

      const origin = new URL(request.url).origin;
      return Response.json(await snapshot(inviteUrl(origin, token)));
    } else {
      await db
        .delete(invites)
        .where(and(eq(invites.id, body.inviteId), isNull(invites.acceptedAt)));
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
