import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ageCategories, groups, waitlist } from "@/db/schema";
import {
  type WaitlistSnapshot,
  type WaitlistStatus,
  firstIssue,
  waitlistRequest,
  waitlistStatusValues,
} from "@/lib/api-schemas";
import { ageLabel } from "@/lib/format";
import { resolveScope, scopeFailure } from "@/lib/scope";

/** A stored month is the first of that month; the API speaks "YYYY-MM". */
const toMonthStart = (month: string | null) => (month ? `${month}-01` : null);

async function snapshot(BRANCH_ID: number): Promise<WaitlistSnapshot> {
  const db = getDb();
  const [rows, groupRows, categoryRows] = await Promise.all([
    db
      .select({
        id: waitlist.id,
        childName: waitlist.childName,
        childBirthDate: waitlist.childBirthDate,
        parentName: waitlist.parentName,
        parentPhone: waitlist.parentPhone,
        parentEmail: waitlist.parentEmail,
        preferredGroupId: waitlist.preferredGroupId,
        preferredGroupName: groups.name,
        desiredFrom: waitlist.desiredFrom,
        status: waitlist.status,
        note: waitlist.note,
        createdAt: waitlist.createdAt,
      })
      .from(waitlist)
      .leftJoin(groups, eq(groups.id, waitlist.preferredGroupId))
      .where(eq(waitlist.branchId, BRANCH_ID))
      // oldest request first: the queue is served in the order people joined
      .orderBy(asc(waitlist.createdAt), asc(waitlist.id)),
    db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(eq(groups.branchId, BRANCH_ID))
      .orderBy(asc(groups.id)),
    db
      .select({
        id: ageCategories.id,
        name: ageCategories.name,
        fromYear: ageCategories.fromYear,
        toYear: ageCategories.toYear,
      })
      .from(ageCategories)
      .where(eq(ageCategories.branchId, BRANCH_ID))
      // найстарші діти першими — черга до них доходить раніше
      .orderBy(asc(ageCategories.fromYear), asc(ageCategories.id)),
  ]);

  const summary = Object.fromEntries(
    waitlistStatusValues.map((status) => [
      status,
      rows.filter((row) => row.status === status).length,
    ]),
  ) as Record<WaitlistStatus, number>;

  return {
    rows: rows.map((row) => ({
      id: row.id,
      childName: row.childName,
      childBirthDate: row.childBirthDate,
      ageLabel: ageLabel(row.childBirthDate),
      parentName: row.parentName,
      parentPhone: row.parentPhone,
      parentEmail: row.parentEmail ?? "",
      preferredGroupId: row.preferredGroupId,
      preferredGroupName: row.preferredGroupName ?? "",
      desiredFrom: row.desiredFrom ? row.desiredFrom.slice(0, 7) : null,
      status: row.status,
      note: row.note ?? "",
      createdAt: row.createdAt.toISOString().slice(0, 10),
    })),
    groups: groupRows,
    categories: categoryRows,
    summary: { ...summary, total: rows.length },
  };
}

export async function GET(request: Request) {
  try {
    const { branchId } = await resolveScope(
      new URL(request.url).searchParams.get("branch"),
    );
    return Response.json(await snapshot(branchId));
  } catch (error) {
    return scopeFailure(error) ?? Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { branchId } = await resolveScope(
      new URL(request.url).searchParams.get("branch"),
    );
    const parsed = waitlistRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const db = getDb();
    const body = parsed.data;

    if (body.kind === "category_add") {
      await db.insert(ageCategories).values({
        branchId,
        name: body.name,
        fromYear: Math.min(body.fromYear, body.toYear),
        toYear: Math.max(body.fromYear, body.toYear),
      });
    } else if (body.kind === "category_update") {
      await db
        .update(ageCategories)
        .set({
          name: body.name,
          fromYear: Math.min(body.fromYear, body.toYear),
          toYear: Math.max(body.fromYear, body.toYear),
        })
        .where(
          and(
            eq(ageCategories.id, body.categoryId),
            eq(ageCategories.branchId, branchId),
          ),
        );
    } else if (body.kind === "category_remove") {
      // Заявки на категорію не посилаються — вони потрапляють у неї за роком
      // народження, тож видалення категорії нічого не осиротить.
      await db
        .delete(ageCategories)
        .where(
          and(
            eq(ageCategories.id, body.categoryId),
            eq(ageCategories.branchId, branchId),
          ),
        );
    } else if (body.kind === "remove") {
      await db.delete(waitlist).where(eq(waitlist.id, body.entryId));
    } else if (body.kind === "status") {
      await db
        .update(waitlist)
        .set({ status: body.status })
        .where(eq(waitlist.id, body.entryId));
    } else {
      const values = {
        childName: body.childName,
        childBirthDate: body.childBirthDate,
        parentName: body.parentName,
        parentPhone: body.parentPhone,
        parentEmail: body.parentEmail || null,
        preferredGroupId: body.preferredGroupId,
        desiredFrom: toMonthStart(body.desiredFrom),
        note: body.note || null,
      };
      if (body.kind === "add") {
        await db.insert(waitlist).values({ branchId, ...values });
      } else {
        await db
          .update(waitlist)
          .set(values)
          .where(eq(waitlist.id, body.entryId));
      }
    }

    return Response.json(await snapshot(branchId));
  } catch (error) {
    return scopeFailure(error) ?? Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}
