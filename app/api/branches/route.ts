import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { branches, children, staff, users } from "@/db/schema";
import {
  type BranchesSnapshot,
  branchRequest,
  firstIssue,
} from "@/lib/api-schemas";
import { ScopeError, resolveOwner, scopeFailure } from "@/lib/scope";

/** Усе тут звужене до садочка власника: філії, лічильники й люди. Без цього
 *  розділ показував би чужі садочки тому, хто просто має роль `admin`. */
async function snapshot(kindergartenId: number): Promise<BranchesSnapshot> {
  const db = getDb();
  const [rows, staffCounts, userRows] = await Promise.all([
    db
      .select({
        id: branches.id,
        name: branches.name,
        address: branches.address,
        monthlyFee: branches.monthlyFee,
        children: sql<number>`count(${children.id}) filter (where ${children.status} <> 'left')::int`,
      })
      .from(branches)
      .leftJoin(children, eq(children.branchId, branches.id))
      .where(eq(branches.kindergartenId, kindergartenId))
      .groupBy(branches.id)
      .orderBy(asc(branches.id)),
    db
      .select({
        branchId: staff.branchId,
        count: sql<number>`count(*) filter (where ${staff.active})::int`,
      })
      .from(staff)
      .innerJoin(branches, eq(branches.id, staff.branchId))
      .where(eq(branches.kindergartenId, kindergartenId))
      .groupBy(staff.branchId),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        branchId: users.branchId,
      })
      .from(users)
      .where(eq(users.kindergartenId, kindergartenId))
      .orderBy(asc(users.id)),
  ]);

  return {
    branches: rows.map((row) => ({
      id: row.id,
      name: row.name,
      address: row.address ?? "",
      monthlyFee: row.monthlyFee,
      children: row.children,
      staff: staffCounts.find((item) => item.branchId === row.id)?.count ?? 0,
      managers: userRows
        .filter((user) => user.branchId === row.id)
        .map((user) => ({
          id: user.id,
          name: user.name ?? "",
          email: user.email,
        })),
    })),
    users: userRows.map((user) => ({
      id: user.id,
      name: user.name ?? "",
      email: user.email,
      branchId: user.branchId,
    })),
  };
}

export async function GET() {
  try {
    const { kindergartenId } = await resolveOwner();
    return Response.json(await snapshot(kindergartenId));
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
    const { kindergartenId } = await resolveOwner();
    const parsed = branchRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const db = getDb();
    const body = parsed.data;

    if (body.kind === "create") {
      await db.insert(branches).values({
        kindergartenId,
        name: body.name,
        address: body.address || null,
        monthlyFee: body.monthlyFee,
      });
    } else if (body.kind === "rename") {
      // Умова по садочку, а не лише по id: чужу філію не перейменувати навіть
      // підставивши її номер руками.
      await db
        .update(branches)
        .set({
          name: body.name,
          address: body.address || null,
          monthlyFee: body.monthlyFee,
        })
        .where(
          and(
            eq(branches.id, body.branchId),
            eq(branches.kindergartenId, kindergartenId),
          ),
        );
    } else {
      // A person tied to a branch becomes its manager; clearing the branch
      // hands them back the owner's unrestricted view.
      if (body.branchId) {
        const [target] = await db
          .select({ id: branches.id })
          .from(branches)
          .where(
            and(
              eq(branches.id, body.branchId),
              eq(branches.kindergartenId, kindergartenId),
            ),
          );
        if (!target) throw new ScopeError("Немає доступу до цієї філії", 403);
      }
      await db
        .update(users)
        .set({
          branchId: body.branchId,
          role: body.branchId ? "manager" : "admin",
        })
        .where(
          and(
            eq(users.id, body.userId),
            eq(users.kindergartenId, kindergartenId),
          ),
        );
    }

    return Response.json(await snapshot(kindergartenId));
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
