import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { branches, children, staff, users } from "@/db/schema";
import {
  type BranchesSnapshot,
  branchRequest,
  firstIssue,
} from "@/lib/api-schemas";
import { ScopeError, resolveScope, scopeFailure } from "@/lib/scope";

/** Managing branches is the owner's job alone. */
async function requireOwner() {
  const scope = await resolveScope();
  if (!scope.isOwner)
    throw new ScopeError("Доступно лише власнику", 403);
  return scope;
}

async function snapshot(): Promise<BranchesSnapshot> {
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
      .groupBy(branches.id)
      .orderBy(asc(branches.id)),
    db
      .select({
        branchId: staff.branchId,
        count: sql<number>`count(*) filter (where ${staff.active})::int`,
      })
      .from(staff)
      .groupBy(staff.branchId),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        branchId: users.branchId,
      })
      .from(users)
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
    await requireOwner();
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
    await requireOwner();
    const parsed = branchRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const db = getDb();
    const body = parsed.data;

    if (body.kind === "create") {
      await db.insert(branches).values({
        name: body.name,
        address: body.address || null,
        monthlyFee: body.monthlyFee,
      });
    } else if (body.kind === "rename") {
      await db
        .update(branches)
        .set({
          name: body.name,
          address: body.address || null,
          monthlyFee: body.monthlyFee,
        })
        .where(eq(branches.id, body.branchId));
    } else {
      // A person tied to a branch becomes its manager; clearing the branch
      // hands them back the owner's unrestricted view.
      await db
        .update(users)
        .set({
          branchId: body.branchId,
          role: body.branchId ? "manager" : "admin",
        })
        .where(eq(users.id, body.userId));
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
