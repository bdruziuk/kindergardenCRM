import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { children, groups, transactions } from "@/db/schema";
import { FALLBACK_MONTH, monthStart } from "@/lib/period";
import {
  childrenWithPayments,
  paymentsSummary,
  staffWithAttendance,
  upcomingBirthdays,
} from "@/lib/queries";
import { resolveScope, scopeFailure } from "@/lib/scope";

export type DashboardDto = Awaited<ReturnType<typeof snapshot>>;

async function snapshot(branchId: number, month: string) {
  const db = getDb();
  const billingMonth = monthStart(month);

  const [childRows, staffData, counts, expenseRows, birthdays] = await Promise.all([
    childrenWithPayments(branchId, month),
    staffWithAttendance(branchId, month),
    db
      .select({
        activeChildren: sql<number>`count(*) filter (where ${children.status} = 'active')::int`,
        groupCount: sql<number>`(select count(*) from ${groups} where ${groups.branchId} = ${branchId})::int`,
      })
      .from(children)
      .where(eq(children.branchId, branchId)),
    db
      .select({ amount: transactions.amount })
      .from(transactions)
      .where(
        and(
          eq(transactions.branchId, branchId),
          sql`${transactions.occurredAt} >= ${billingMonth}::date
              and ${transactions.occurredAt} < (${billingMonth}::date + interval '1 month')`,
        ),
      ),
    upcomingBirthdays(branchId, 3),
  ]);

  const salaryPaid = staffData.rows.reduce(
    (sum, row) => sum + row.paidOut.total,
    0,
  );
  const summary = paymentsSummary(childRows);
  const salaryAccrued = staffData.rows.reduce((sum, row) => sum + row.salary, 0);
  const otherExpenses = expenseRows.reduce((sum, row) => sum + row.amount, 0);

  // Progress per group, ordered by how much is still outstanding.
  const byGroup = new Map<string, { planned: number; paid: number }>();
  for (const child of childRows) {
    const entry = byGroup.get(child.group) ?? { planned: 0, paid: 0 };
    entry.planned += child.fee;
    entry.paid += child.paid;
    byGroup.set(child.group, entry);
  }

  return {
    month: billingMonth.slice(0, 7),
    payments: summary,
    children: {
      active: counts[0]?.activeChildren ?? 0,
      groups: counts[0]?.groupCount ?? 0,
      awaiting: summary.partialCount + summary.unpaidCount,
    },
    salary: {
      // There is no record of actual payouts yet, so this is what the month
      // has accrued from attendance and lessons — not what has been handed over.
      accrued: salaryAccrued,
      staffCount: staffData.rows.length,
      // Same rule as the staff page: only staff paid by days are counted.
      workedDays: staffData.rows
        .filter((row) => row.salaryType !== "lesson")
        .reduce((sum, row) => sum + row.workedDays, 0),
      lessonCount: staffData.rows.reduce((sum, row) => sum + row.lessonCount, 0),
      workdays: staffData.info.workdays,
      /** Handed over this month; the rest of `accrued` is still owed. */
      paid: salaryPaid,
    },
    expenses: {
      // Cash out, so salary counts when it was handed over, not when accrued.
      total: salaryPaid + otherExpenses,
      salary: salaryPaid,
      other: otherExpenses,
    },
    groupProgress: [...byGroup.entries()]
      .map(([name, entry]) => ({
        name,
        planned: entry.planned,
        paid: entry.paid,
        progress: entry.planned
          ? Math.round((entry.paid / entry.planned) * 100)
          : 0,
      }))
      .sort((a, b) => b.progress - a.progress),
    birthdays,
  };
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const { branchId } = await resolveScope(params.get("branch"));
    const month = params.get("month") ?? FALLBACK_MONTH;
    return Response.json(await snapshot(branchId, month));
  } catch (error) {
    return scopeFailure(error) ?? Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}
