import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  branches,
  children,
  groupStaff,
  groups,
  relatives,
  staff,
} from "@/db/schema";
import {
  type ChildInput,
  type KindergartenSnapshot,
  firstIssue,
  kindergartenRequest,
} from "@/lib/api-schemas";
import { ageLabel, initialsOf, moneyLabel } from "@/lib/format";
import { resolveScope, scopeFailure } from "@/lib/scope";

async function branchFee(BRANCH_ID: number) {
  const db = getDb();
  const [branch] = await db
    .select({ monthlyFee: branches.monthlyFee })
    .from(branches)
    .where(eq(branches.id, BRANCH_ID));
  return branch?.monthlyFee ?? 0;
}

async function snapshot(BRANCH_ID: number): Promise<KindergartenSnapshot> {
  const db = getDb();
  const fee = await branchFee(BRANCH_ID);
  const [groupRows, childRows, relativeRows, staffRows, assignments] =
    await Promise.all([
    db
      .select({
        id: groups.id,
        name: groups.name,
        ageRange: groups.ageRange,
        icon: groups.icon,
        color: groups.color,
        childCount: sql<number>`count(${children.id})::int`,
      })
      .from(groups)
      .leftJoin(children, eq(children.groupId, groups.id))
      .where(eq(groups.branchId, BRANCH_ID))
      .groupBy(groups.id)
      .orderBy(asc(groups.id)),
    db
      .select({
        id: children.id,
        fullName: children.fullName,
        birthDate: children.birthDate,
        customFee: children.customFee,
        status: children.status,
        enrolledAt: children.enrolledAt,
        leftAt: children.leftAt,
        groupName: groups.name,
      })
      .from(children)
      .leftJoin(groups, eq(groups.id, children.groupId))
      .where(eq(children.branchId, BRANCH_ID))
      .orderBy(asc(children.id)),
    db.select().from(relatives).orderBy(asc(relatives.id)),
    // Тільки чинні працівники цієї філії: закріплювати за групою звільненого
    // немає сенсу, а в списку вибору він лише заважав би.
    db
      .select({ id: staff.id, name: staff.fullName, role: staff.role })
      .from(staff)
      .where(and(eq(staff.branchId, BRANCH_ID), eq(staff.active, true)))
      .orderBy(asc(staff.fullName)),
    db
      .select({
        groupId: groupStaff.groupId,
        id: staff.id,
        name: staff.fullName,
        role: staff.role,
      })
      .from(groupStaff)
      .innerJoin(staff, eq(staff.id, groupStaff.staffId))
      .innerJoin(groups, eq(groups.id, groupStaff.groupId))
      .where(eq(groups.branchId, BRANCH_ID))
      .orderBy(asc(staff.fullName)),
  ]);

  return {
    monthlyFee: fee,
    staff: staffRows,
    groups: groupRows.map((group) => ({
      ...group,
      staff: assignments
        .filter((row) => row.groupId === group.id)
        .map(({ id, name, role }) => ({ id, name, role })),
    })),
    children: childRows.map((child) => ({
      id: child.id,
      fullName: child.fullName,
      initials: initialsOf(child.fullName),
      ageLabel: ageLabel(child.birthDate),
      birthDate: child.birthDate,
      groupName: child.groupName ?? "",
      fee: child.customFee ?? fee,
      feeLabel: moneyLabel(child.customFee ?? fee),
      customFee: child.customFee !== null,
      status: child.status,
      enrolledAt: child.enrolledAt,
      leftAt: child.leftAt,
      relatives: relativeRows
        .filter((r) => r.childId === child.id)
        .map((r) => ({
          name: r.fullName,
          note: r.relation,
          phone: r.phone ?? "—",
        })),
    })),
  };
}

async function groupIdByName(BRANCH_ID: number, name: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(sql`${groups.branchId} = ${BRANCH_ID} and ${groups.name} = ${name}`);
  return row?.id ?? null;
}

/** A fee equal to the branch rate is stored as NULL, so "individual fee" in
 *  the UI means exactly that. */
async function childValues(BRANCH_ID: number, input: ChildInput) {
  return {
    groupId: await groupIdByName(BRANCH_ID, input.groupName),
    fullName: input.fullName,
    birthDate: input.birthDate,
    customFee: input.fee === (await branchFee(BRANCH_ID)) ? null : input.fee,
    status: input.status,
    enrolledAt: input.enrolledAt,
    leftAt: input.leftAt,
  };
}

const relativeValues = (input: ChildInput["relatives"], childId: number) =>
  input.map((r) => ({
    childId,
    fullName: r.name,
    relation: r.note || "Родич",
    phone: r.phone || null,
  }));

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
    const { branchId: BRANCH_ID } = await resolveScope(
      new URL(request.url).searchParams.get("branch"),
    );
    const parsed = kindergartenRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        { error: firstIssue(parsed.error) },
        { status: 400 },
      );

    const db = getDb();
    const body = parsed.data;

    if (body.kind === "group") {
      await db
        .insert(groups)
        .values({
          branchId: BRANCH_ID,
          name: body.name,
          ageRange: body.ageRange,
        })
        .onConflictDoNothing();
    } else if (body.kind === "update_group") {
      // Children reference the group by id, so a rename needs no cascade.
      await db
        .update(groups)
        .set({ name: body.name, ageRange: body.ageRange })
        .where(eq(groups.id, body.groupId));
    } else if (body.kind === "group_staff") {
      // Група й усі названі працівники мають належати цій філії — інакше
      // чужого можна було б закріпити, підставивши його номер руками.
      const [group] = await db
        .select({ id: groups.id })
        .from(groups)
        .where(
          and(eq(groups.id, body.groupId), eq(groups.branchId, BRANCH_ID)),
        );
      if (!group)
        return Response.json({ error: "Групу не знайдено" }, { status: 404 });

      const allowed = body.staffIds.length
        ? await db
            .select({ id: staff.id })
            .from(staff)
            .where(
              and(
                eq(staff.branchId, BRANCH_ID),
                inArray(staff.id, body.staffIds),
              ),
            )
        : [];
      if (allowed.length !== body.staffIds.length)
        return Response.json(
          { error: "Не всі працівники належать цій філії" },
          { status: 403 },
        );

      await db.transaction(async (tx) => {
        await tx.delete(groupStaff).where(eq(groupStaff.groupId, body.groupId));
        if (allowed.length)
          await tx.insert(groupStaff).values(
            allowed.map((person) => ({
              groupId: body.groupId,
              staffId: person.id,
            })),
          );
      });
    } else if (body.kind === "child") {
      const values = await childValues(BRANCH_ID, body.child);
      await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(children)
          .values({ branchId: BRANCH_ID, ...values })
          .returning({ id: children.id });
        const kin = relativeValues(body.child.relatives, inserted.id);
        if (kin.length) await tx.insert(relatives).values(kin);
      });
    } else {
      const childId = body.childId;
      const values = await childValues(BRANCH_ID, body.child);
      await db.transaction(async (tx) => {
        await tx.update(children).set(values).where(eq(children.id, childId));
        await tx.delete(relatives).where(eq(relatives.childId, childId));
        const kin = relativeValues(body.child.relatives, childId);
        if (kin.length) await tx.insert(relatives).values(kin);
      });
    }

    return Response.json(await snapshot(BRANCH_ID));
  } catch (error) {
    return scopeFailure(error) ?? Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}
