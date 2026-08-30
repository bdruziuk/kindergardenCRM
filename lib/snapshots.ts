import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { children, groups, jobTitles, transactions } from "@/db/schema";
import {
  type FinanceSnapshot,
  type MethodTotals,
  type PaymentMethod,
  paymentMethodValues,
} from "@/lib/api-schemas";
import { paidByLesson } from "@/lib/format";
import { monthStart } from "@/lib/period";
import {
  childrenWithPayments,
  monthExpenses,
  paymentsSummary,
  salaryProgress,
  staffWithAttendance,
  upcomingBirthdays,
} from "@/lib/queries";

/**
 * Побудова сторінок місяця.
 *
 * Живе окремо від маршрутів, бо ті самі знімки збирає закриття місяця: воно
 * має зберегти рівно те, що людина бачить, а не схожу на неї копію.
 */

/** Сторінка «Оплати» за місяць. */
export async function paymentsSnapshot(branchId: number, month: string) {
  const rows = await childrenWithPayments(branchId, month);
  return {
    month: monthStart(month).slice(0, 7),
    rows,
    summary: paymentsSummary(rows),
  };
}

export async function staffSnapshot(branchId: number, month: string) {
  const { info, rows } = await staffWithAttendance(branchId, month);
  // Посади філії — вони наповнюють випадайку замість колишнього списку,
  // зашитого в сторінку.
  const titles = await getDb()
    .select({
      id: jobTitles.id,
      name: jobTitles.name,
      addedByOwner: jobTitles.addedByOwner,
      salaryType: jobTitles.salaryType,
      rate: jobTitles.rate,
      lessonRate: jobTitles.lessonRate,
      vacationQuota: jobTitles.vacationQuota,
      dayOffQuota: jobTitles.dayOffQuota,
    })
    .from(jobTitles)
    .where(eq(jobTitles.branchId, branchId))
    .orderBy(asc(jobTitles.id));
  // Lesson-paid staff may still carry attendance rows from before they were
  // switched over, but their pay ignores those and the grid shows lessons in
  // their cells — so counting them here would show days nobody can see.
  const onAttendance = rows.filter((row) => !paidByLesson(row.salaryType));
  return {
    ...info,
    jobTitles: titles,
    rows,
    summary: {
      staffCount: rows.length,
      workedDays: onAttendance.reduce((sum, row) => sum + row.workedDays, 0),
      absentDays: onAttendance.reduce((sum, row) => sum + row.absentDays, 0),
      vacationDays: onAttendance.reduce((sum, row) => sum + row.vacationDays, 0),
      dayOffDays: onAttendance.reduce((sum, row) => sum + row.dayOffDays, 0),
      lessonCount: rows.reduce((sum, row) => sum + row.lessonCount, 0),
      salaryTotal: rows.reduce((sum, row) => sum + row.salary, 0),
      paidOutTotal: rows.reduce((sum, row) => sum + row.paidOut.total, 0),
    },
  };
}

/** The one expense the app derives itself; it cannot be edited by hand. */
const SALARY_CATEGORY = "Зарплата";

export async function financeSnapshot(
  branchId: number,
  month: string,
): Promise<FinanceSnapshot> {
  const [childRows, salaryRows, rows] = await Promise.all([
    childrenWithPayments(branchId, month),
    salaryProgress(branchId, month),
    monthExpenses(branchId, month),
  ]);

  // Income is not a ledger of its own: the only money coming in is the
  // monthly fee, so it is whatever the parents have actually paid.
  const income = paymentsSummary(childRows).received;

  // The expense is the cash that actually left, mirroring income being what
  // parents actually paid. What the timesheet accrued is reported alongside.
  const salaryAccrued = salaryRows.reduce((sum, row) => sum + row.accrued, 0);
  const salary = salaryRows.reduce((sum, row) => sum + row.paid, 0);
  const salaryRemaining = Math.round((salaryAccrued - salary) * 100) / 100;
  const other = rows.reduce((sum, row) => sum + row.amount, 0);
  const total = salary + other;

  const byCategory = new Map<string, number>();
  if (salary) byCategory.set(SALARY_CATEGORY, salary);
  for (const row of rows)
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.amount);

  // Розклад по видах оплати. Витрата віднімається саме від доходів свого
  // виду — готівка з готівки, — бо це різні гаманці, і спільний підсумок
  // ховав би те, що на карті грошей уже немає, поки в касі вони ще є.
  const zero = () => ({ income: 0, expense: 0 });
  const perMethod = new Map<PaymentMethod, { income: number; expense: number }>(
    paymentMethodValues.map((method) => [method, zero()]),
  );

  for (const child of childRows)
    for (const item of child.history)
      perMethod.get(item.method)!.income += item.amount;

  for (const row of rows) perMethod.get(row.method)!.expense += row.amount;

  // Зарплата — теж витрата, і теж має вид: без неї підсумок не сходився б
  // саме на найбільшій статті.
  for (const person of salaryRows)
    for (const item of person.payouts)
      perMethod.get(item.method)!.expense += item.amount;

  const methods: MethodTotals[] = paymentMethodValues.map((method) => {
    const totals = perMethod.get(method) ?? zero();
    return {
      method,
      income: Math.round(totals.income * 100) / 100,
      expense: Math.round(totals.expense * 100) / 100,
      balance: Math.round((totals.income - totals.expense) * 100) / 100,
    };
  });

  const categories = [...byCategory.entries()]
    .map(([category, amount]) => ({
      category,
      amount,
      share: total ? Math.round((amount / total) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    month: monthStart(month).slice(0, 7),
    rows,
    salaryRows,
    summary: {
      income,
      expense: { salary, other, total },
      salaryAccrued,
      salaryRemaining,
      balance: Math.round((income - total) * 100) / 100,
    },
    categories,
    methods,
  };
}

export async function dashboardSnapshot(branchId: number, month: string) {
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
        .filter((row) => !paidByLesson(row.salaryType))
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
