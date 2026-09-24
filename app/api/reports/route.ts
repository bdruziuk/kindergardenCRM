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
  type StaffSnapshot,
  type WaitlistStatus,
  MONTH,
  waitlistStatusValues,
} from "@/lib/api-schemas";
import { totalDebt } from "@/lib/cash";
import { monthRange, payrollDebt, yearRange } from "@/lib/cash-queries";
import { loadClose } from "@/lib/month-close";
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
  const closed = month ? await loadClose(BRANCH_ID, month) : null;
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
    otherIncomeRows,
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
        month: sql<string>`to_char(${transactions.occurredAt}, 'YYYY-MM')`,
        total: sql<number>`sum(${transactions.amount})::float8`,
      })
      .from(transactions)
      .where(and(
        eq(transactions.branchId, BRANCH_ID),
        eq(transactions.direction, "income"),
        sql`${transactions.occurredAt} >= ${yearFrom}::date and ${transactions.occurredAt} < ${yearTo}::date`,
      ))
      .groupBy(sql`1`),
    db
      .select({
        // За датою оплати, а не за місяцем нарахування: жовтневу плату,
        // внесену у вересні, каса бачить у вересні.
        month: sql<string>`to_char(${payments.paidAt}, 'YYYY-MM')`,
        total: sql<number>`sum(${payments.amount})::float8`,
      })
      .from(payments)
      // payments carry no branch of their own — they belong to one through
      // the child, so the join is what keeps branches apart
      .innerJoin(children, eq(children.id, payments.childId))
      .where(
        and(
          eq(children.branchId, BRANCH_ID),
          sql`${payments.paidAt} >= ${yearFrom}::date and ${payments.paidAt} < ${yearTo}::date`,
        ),
      )
      .groupBy(sql`1`),
    db
      .select({
        // За датою видачі: грудневу зарплату, видану в січні, показує січень
        // наступного року, а не грудень.
        month: sql<string>`to_char(${salaryPayments.paidAt}, 'YYYY-MM')`,
        total: sql<number>`sum(${salaryPayments.amount})::float8`,
      })
      .from(salaryPayments)
      .innerJoin(staff, eq(staff.id, salaryPayments.staffId))
      .where(
        and(
          eq(staff.branchId, BRANCH_ID),
          sql`${salaryPayments.paidAt} >= ${yearFrom}::date and ${salaryPayments.paidAt} < ${yearTo}::date`,
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
          eq(transactions.direction, "expense"),
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
          eq(transactions.direction, "expense"),
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
          sql`${salaryPayments.paidAt} >= ${from}::date and ${salaryPayments.paidAt} < ${until}`,
        ),
      )
      // Звільнені лишаються: виплати, зроблені їм у цьому періоді, нікуди не
      // діваються від того, що людина більше не працює.
      .where(eq(staff.branchId, BRANCH_ID))
      .groupBy(staff.id)
      .orderBy(asc(staff.id)),
    db
      .select({ status: waitlist.status, count: sql<number>`count(*)::int` })
      .from(waitlist)
      .where(eq(waitlist.branchId, BRANCH_ID))
      .groupBy(waitlist.status),
    // Accrued salary needs the timesheet, so it is only affordable for one
    // month; a yearly report reports what was handed over and nothing else.
    month
      ? closed
        ? Promise.resolve(closed.snapshot.staff as StaffSnapshot)
        : staffWithAttendance(BRANCH_ID, month)
      : Promise.resolve(null),
  ]);

  // Борг на кінець періоду рахує лише ті виплати, що були зроблені до цієї
  // дати. Пізніша виплата не має переписувати те, що показує минулий звіт.
  const periodEnd = month ? monthRange(month).until : yearRange(year).until;
  const lastDay = new Date(`${periodEnd}T00:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  const asOf = lastDay.toISOString().slice(0, 10);
  const debtAtEnd = await payrollDebt(
    BRANCH_ID,
    month ?? `${year}-12`,
    asOf,
  );

  const pick = (rows: { month: string; total: number }[], key: string) =>
    rows.find((row) => row.month === key)?.total ?? 0;

  const months: ReportMonthDto[] = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, "0")}`;
    const income = pick(incomeRows, key) + pick(otherIncomeRows, key);
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
      /** Невиплачена зарплата станом на останній день періоду. */
      salaryDebtAtEnd: totalDebt(debtAtEnd),
      debtAsOf: asOf,
    },
    categories,
    groups: groupRows.map((row) => ({ name: row.name, children: row.count })),
    children: childCounts[0] ?? {
      inPeriod: 0,
      joined: 0,
      left: 0,
      paused: 0,
    },
    // Закритий місяць зберігає і суми, і склад колективу: працівника могли
    // звільнити або перейменувати після закриття. Поточний список тут не підходить.
    staff: monthly ? monthly.rows.map((person) => ({
      id: person.id,
      name: person.name,
      role: person.role,
      paid: person.paidOut.total,
      accrued: person.salary,
      remaining: person.remaining,
    })) : payoutRows.map((person) => {
      return { ...person, accrued: null, remaining: null };
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
