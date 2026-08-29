import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  children,
  groups,
  payments,
  salaryPayments,
  staff,
  transactions,
  waitlist,
} from "@/db/schema";
import {
  type CategoryTotal,
  type ReportMonthDto,
  type ReportsSnapshot,
  type WaitlistStatus,
  MONTH,
  waitlistStatusValues,
} from "@/lib/api-schemas";
import { staffWithAttendance } from "@/lib/queries";
import { resolveScope, scopeFailure } from "@/lib/scope";

const SALARY_CATEGORY = "Зарплата";

/**
 * Two windows at once: the twelve monthly aggregates always cover the whole
 * year so the chart keeps its context, while categories and payouts follow
 * the selected period. Everything is grouped in SQL — a year of per-month
 * snapshots would be dozens of round trips for the same sums.
 */
async function snapshot(
  BRANCH_ID: number,
  year: number,
  month: string | null,
): Promise<ReportsSnapshot> {
  const db = getDb();
  const yearFrom = `${year}-01-01`;
  const yearTo = `${year + 1}-01-01`;
  const from = month ? `${month}-01` : yearFrom;
  const until = month
    ? sql`(${from}::date + interval '1 month')`
    : sql`${yearTo}::date`;

  // Дитина належить періоду, якщо вікно її перебування в садочку перетинається
  // з періодом звіту. Порожня дата — «невідомо», і тоді вона межу не звужує:
  // такі діти рахуються в будь-якому періоді, а не зникають зі звітів.
  const inPeriod = sql`(${children.enrolledAt} is null or ${children.enrolledAt} < ${until})
      and (${children.leftAt} is null or ${children.leftAt} >= ${from}::date)`;

  const [
    incomeRows,
    salaryRows,
    expenseRows,
    categoryRows,
    groupRows,
    childCounts,
    payoutRows,
    waitlistRows,
    monthly,
  ] = await Promise.all([
    db
      .select({
        month: sql<string>`to_char(${payments.billingMonth}, 'YYYY-MM')`,
        total: sql<number>`sum(${payments.amount})::float8`,
      })
      .from(payments)
      // payments carry no branch of their own — they belong to one through
      // the child, so the join is what keeps branches apart
      .innerJoin(children, eq(children.id, payments.childId))
      .where(
        and(
          eq(children.branchId, BRANCH_ID),
          sql`${payments.billingMonth} >= ${yearFrom}::date and ${payments.billingMonth} < ${yearTo}::date`,
        ),
      )
      .groupBy(sql`1`),
    db
      .select({
        month: sql<string>`to_char(${salaryPayments.month}, 'YYYY-MM')`,
        total: sql<number>`sum(${salaryPayments.amount})::float8`,
      })
      .from(salaryPayments)
      .innerJoin(staff, eq(staff.id, salaryPayments.staffId))
      .where(
        and(
          eq(staff.branchId, BRANCH_ID),
          sql`${salaryPayments.month} >= ${yearFrom}::date and ${salaryPayments.month} < ${yearTo}::date`,
        ),
      )
      .groupBy(sql`1`),
    db
      .select({
        month: sql<string>`to_char(${transactions.occurredAt}, 'YYYY-MM')`,
        total: sql<number>`sum(${transactions.amount})::float8`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.branchId, BRANCH_ID),
          sql`${transactions.occurredAt} >= ${yearFrom}::date and ${transactions.occurredAt} < ${yearTo}::date`,
        ),
      )
      .groupBy(sql`1`),
    db
      .select({
        category: transactions.category,
        total: sql<number>`sum(${transactions.amount})::float8`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.branchId, BRANCH_ID),
          sql`${transactions.occurredAt} >= ${from}::date and ${transactions.occurredAt} < ${until}`,
        ),
      )
      .groupBy(transactions.category),
    db
      .select({
        name: groups.name,
        count: sql<number>`count(${children.id})::int`,
      })
      .from(groups)
      .leftJoin(
        children,
        and(eq(children.groupId, groups.id), inPeriod),
      )
      .where(eq(groups.branchId, BRANCH_ID))
      .groupBy(groups.id)
      .orderBy(asc(groups.id)),
    db
      .select({
        inPeriod: sql<number>`count(*) filter (where ${inPeriod})::int`,
        joined: sql<number>`count(*) filter (where ${children.enrolledAt} >= ${from}::date and ${children.enrolledAt} < ${until})::int`,
        left: sql<number>`count(*) filter (where ${children.leftAt} >= ${from}::date and ${children.leftAt} < ${until})::int`,
        paused: sql<number>`count(*) filter (where ${children.status} = 'paused')::int`,
      })
      .from(children)
      .where(eq(children.branchId, BRANCH_ID)),
    db
      .select({
        id: staff.id,
        name: staff.fullName,
        role: staff.role,
        paid: sql<number>`coalesce(sum(${salaryPayments.amount}), 0)::float8`,
      })
      .from(staff)
      .leftJoin(
        salaryPayments,
        and(
          eq(salaryPayments.staffId, staff.id),
          sql`${salaryPayments.month} >= ${from}::date and ${salaryPayments.month} < ${until}`,
        ),
      )
      .where(and(eq(staff.branchId, BRANCH_ID), eq(staff.active, true)))
      .groupBy(staff.id)
      .orderBy(asc(staff.id)),
    db
      .select({ status: waitlist.status, count: sql<number>`count(*)::int` })
      .from(waitlist)
      .where(eq(waitlist.branchId, BRANCH_ID))
      .groupBy(waitlist.status),
    // Accrued salary needs the timesheet, so it is only affordable for one
    // month; a yearly report reports what was handed over and nothing else.
    month ? staffWithAttendance(BRANCH_ID, month) : Promise.resolve(null),
  ]);

  const pick = (rows: { month: string; total: number }[], key: string) =>
    rows.find((row) => row.month === key)?.total ?? 0;

  const months: ReportMonthDto[] = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, "0")}`;
    const income = pick(incomeRows, key);
    const salaryPaid = pick(salaryRows, key);
    const otherExpenses = pick(expenseRows, key);
    const expenses = salaryPaid + otherExpenses;
    return {
      month: key,
      income,
      salaryPaid,
      otherExpenses,
      expenses,
      balance: Math.round((income - expenses) * 100) / 100,
    };
  });

  const scoped = month
    ? months.filter((row) => row.month === month)
    : months;
  const sum = (key: keyof ReportMonthDto) =>
    Math.round(
      scoped.reduce((total, row) => total + (row[key] as number), 0) * 100,
    ) / 100;

  const totalIncome = sum("income");
  const totalExpenses = sum("expenses");
  const salaryTotal = sum("salaryPaid");
  const withIncome = months.filter((row) => row.income > 0);
  const best = withIncome.length
    ? withIncome.reduce((a, b) => (b.income > a.income ? b : a))
    : null;

  const categories: CategoryTotal[] = [
    ...(salaryTotal ? [{ category: SALARY_CATEGORY, amount: salaryTotal }] : []),
    ...categoryRows.map((row) => ({ category: row.category, amount: row.total })),
  ]
    .map((row) => ({
      ...row,
      share: totalExpenses ? Math.round((row.amount / totalExpenses) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const waitlistCounts = Object.fromEntries(
    waitlistStatusValues.map((status) => [
      status,
      waitlistRows.find((row) => row.status === status)?.count ?? 0,
    ]),
  ) as Record<WaitlistStatus, number>;

  return {
    period: month ? "month" : "year",
    year,
    month,
    months,
    totals: {
      income: totalIncome,
      salaryPaid: salaryTotal,
      otherExpenses: sum("otherExpenses"),
      expenses: totalExpenses,
      balance: Math.round((totalIncome - totalExpenses) * 100) / 100,
      bestMonth: best?.month ?? null,
    },
    categories,
    groups: groupRows.map((row) => ({ name: row.name, children: row.count })),
    children: childCounts[0] ?? {
      inPeriod: 0,
      joined: 0,
      left: 0,
      paused: 0,
    },
    staff: payoutRows.map((person) => {
      const timesheet = monthly?.rows.find((row) => row.id === person.id);
      return {
        ...person,
        accrued: timesheet ? timesheet.salary : null,
        remaining: timesheet ? timesheet.remaining : null,
      };
    }),
    waitlist: {
      ...waitlistCounts,
      total: waitlistRows.reduce((total, row) => total + row.count, 0),
    },
  };
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const { branchId } = await resolveScope(params.get("branch"));
    const rawMonth = params.get("month");
    const month = rawMonth && MONTH.test(rawMonth) ? rawMonth : null;

    const rawYear = Number(params.get("year"));
    const year = month
      ? Number(month.slice(0, 4))
      : Number.isInteger(rawYear) && rawYear >= 2000 && rawYear <= 2100
        ? rawYear
        : new Date().getFullYear();

    return Response.json(await snapshot(branchId, year, month));
  } catch (error) {
    return scopeFailure(error) ?? Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}
