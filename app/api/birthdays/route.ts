import { and, asc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { birthdayParties, children, groups } from "@/db/schema";
import {
  type BirthdayCalendarDto,
  MONTH,
  birthdayRequest,
  firstIssue,
} from "@/lib/api-schemas";
import { currentMonth } from "@/lib/period";
import { ScopeError, resolveScope, scopeFailure } from "@/lib/scope";

/**
 * День народження в показаному році. 29 лютого в невисокосний рік святкують
 * 28-го — інакше такі діти зникали б із календаря на три роки з чотирьох.
 */
function birthdayIn(year: number, birthDate: string) {
  const month = Number(birthDate.slice(5, 7));
  let day = Number(birthDate.slice(8, 10));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > last) day = last;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function snapshot(branchId: number, month: string): Promise<BirthdayCalendarDto> {
  const db = getDb();
  const year = Number(month.slice(0, 4));
  const monthNumber = month.slice(5, 7);
  const from = `${month}-01`;

  const [kids, parties] = await Promise.all([
    db
      .select({
        id: children.id,
        name: children.fullName,
        birthDate: children.birthDate,
        groupName: groups.name,
      })
      .from(children)
      .leftJoin(groups, eq(groups.id, children.groupId))
      // Вибулі вже не святкують у садочку — ні в календарі, ні у виборі.
      .where(and(eq(children.branchId, branchId), ne(children.status, "left")))
      .orderBy(asc(children.fullName)),
    db
      .select({
        id: birthdayParties.id,
        childId: birthdayParties.childId,
        childName: children.fullName,
        date: birthdayParties.date,
        startTime: birthdayParties.startTime,
        durationMinutes: birthdayParties.durationMinutes,
        note: birthdayParties.note,
      })
      .from(birthdayParties)
      .innerJoin(children, eq(children.id, birthdayParties.childId))
      .where(
        and(
          eq(birthdayParties.branchId, branchId),
          sql`${birthdayParties.date} >= ${from}::date and ${birthdayParties.date} < (${from}::date + interval '1 month')`,
        ),
      )
      .orderBy(asc(birthdayParties.date), asc(birthdayParties.startTime)),
  ]);

  const birthdays = kids
    .filter((kid) => kid.birthDate?.slice(5, 7) === monthNumber)
    .map((kid) => ({
      childId: kid.id,
      name: kid.name,
      groupName: kid.groupName ?? "",
      date: birthdayIn(year, kid.birthDate!),
      turns: year - Number(kid.birthDate!.slice(0, 4)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  return {
    month,
    birthdays,
    parties: parties.map((party) => ({ ...party, note: party.note ?? "" })),
    children: kids.map((kid) => ({ id: kid.id, name: kid.name })),
  };
}

const monthOf = (request: Request) => {
  const raw = new URL(request.url).searchParams.get("month");
  return raw && MONTH.test(raw) ? raw : currentMonth();
};

export async function GET(request: Request) {
  try {
    const { branchId } = await resolveScope(
      new URL(request.url).searchParams.get("branch"),
    );
    return Response.json(await snapshot(branchId, monthOf(request)));
  } catch (error) {
    return scopeFailure(error) ?? Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { branchId, canManageBranch } = await resolveScope(
      new URL(request.url).searchParams.get("branch"),
      { write: true },
    );
    // Свята планує той, хто веде філію; вихователь календар лише бачить.
    if (!canManageBranch)
      throw new ScopeError("Свята планує власник або керуючий філії", 403);

    const parsed = birthdayRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const db = getDb();
    const body = parsed.data;

    if (body.kind !== "party_remove") {
      // Дитина має бути саме з цієї філії — інакше чужу можна було б
      // підставити номером.
      const [child] = await db
        .select({ id: children.id })
        .from(children)
        .where(and(eq(children.id, body.childId), eq(children.branchId, branchId)));
      if (!child) throw new ScopeError("Дитину не знайдено", 404);
    }

    const values =
      body.kind === "party_remove"
        ? null
        : {
            childId: body.childId,
            date: body.date,
            startTime: body.startTime,
            durationMinutes: body.durationMinutes,
            note: body.note || null,
          };

    if (body.kind === "party_add") {
      await db.insert(birthdayParties).values({ branchId, ...values! });
    } else {
      const own = and(
        eq(birthdayParties.id, body.partyId),
        eq(birthdayParties.branchId, branchId),
      );
      const [touched] =
        body.kind === "party_update"
          ? await db.update(birthdayParties).set(values!).where(own).returning({ id: birthdayParties.id })
          : await db.delete(birthdayParties).where(own).returning({ id: birthdayParties.id });
      if (!touched) throw new ScopeError("Свято не знайдено", 404);
    }

    return Response.json(await snapshot(branchId, monthOf(request)));
  } catch (error) {
    return scopeFailure(error) ?? Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}
