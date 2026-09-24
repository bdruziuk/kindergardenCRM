import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { children, groups, jobTitles, transactions } from "@/db/schema";
import type { FinanceSnapshot, MethodTotals } from "@/lib/api-schemas";
import { hasOpening, methodFlows, totalDebt, totalOverpaid } from "@/lib/cash";
import {
  cashExpense,
  cashIncome,
  monthRange,
  openingAt,
  payrollDebt,
} from "@/lib/cash-queries";
import { diffMoney, money, sumMoney } from "@/lib/money";
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

/**
 * Сторінка «Доходи й витрати» за місяць.
 *
 * Дві різні речі в одному місці, і їх не можна змішувати:
 *
 * «Витрати за період» — гроші, що справді вийшли в цьому місяці. Зарплата
 * рахується за датою видачі, тож вересневий аванс — вереснева витрата, а
 * решта, видана 5 жовтня, — жовтнева.
 *
 * «Нараховано» — те, що заробили за цей місяць роботи, незалежно від того,
 * коли за це заплатять. Витратою воно не є.
 */
export async function financeSnapshot(
  branchId: number,
  month: string,
): Promise<FinanceSnapshot> {
  const { from, until } = monthRange(month);
  const [salaryRows, rows, incoming, outgoing, opening, debt] = await Promise.all([
    salaryProgress(branchId, month),
    monthExpenses(branchId, month),
    cashIncome(branchId, from, until),
    cashExpense(branchId, from, until),
    openingAt(branchId, from),
    payrollDebt(branchId, month),
  ]);

  const incomeRows = rows.filter((row) => row.direction === "income");
  const otherIncome = sumMoney(incomeRows, (row) => row.amount);
  // Дохід — гроші, що надійшли в цьому місяці, за датою оплати. Місяць, за
  // який платили, тут ні до чого: жовтневу плату, внесену у вересні, бачить
  // вересень.
  const income = sumMoney(incoming, (row) => row.amount);

  // Нараховано — за місяць роботи; видано — за датою видачі. Це різні суми, і
  // сходитись вони не зобов'язані.
  const salaryAccrued = sumMoney(salaryRows, (row) => row.accrued);
  const salary = sumMoney(outgoing.salary, (row) => row.amount);
  const salaryRemaining = sumMoney(salaryRows, (row) =>
    row.remaining > 0 ? row.remaining : 0,
  );
  const other = sumMoney(outgoing.other, (row) => row.amount);
  const total = money(salary + other);

  const byCategory = new Map<string, number>();
  if (salary) byCategory.set(SALARY_CATEGORY, salary);
  for (const row of outgoing.other)
    byCategory.set(row.category, money((byCategory.get(row.category) ?? 0) + row.amount));

  // Розклад по видах оплати. Витрата віднімається саме від доходів свого
  // виду — готівка з готівки, — бо це різні гаманці, і спільний підсумок
  // ховав би те, що на карті грошей уже немає, поки в касі вони ще є.
  // Зарплата сюди входить за датою видачі, як і решта витрат.
  const flows = methodFlows(
    incoming,
    [...outgoing.salary, ...outgoing.other],
    opening.opening,
  );
  const methods: MethodTotals[] = flows.map((flow) => ({
    method: flow.method,
    opening: flow.opening,
    income: flow.income,
    expense: flow.expense,
    balance: flow.net,
    closing: flow.closing,
  }));

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
      otherIncome,
      expense: { salary, other, total },
      salaryAccrued,
      salaryRemaining,
      salaryDebtTotal: totalDebt(debt),
      salaryOverpaidTotal: totalOverpaid(debt),
      balance: diffMoney(income, total),
      closing: sumMoney(flows, (flow) => flow.closing),
      openingKnown: hasOpening(flows) || opening.since !== null,
      openingSince: opening.since,
    },
    debt,
    categories,
    methods,
  };
}

export async function dashboardSnapshot(branchId: number, month: string) {
  const db = getDb();
  const billingMonth = monthStart(month);

  const { from, until } = monthRange(month);
  const [childRows, staffData, counts, expenseRows, birthdays, outgoing, incoming] =
    await Promise.all([
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
      .select({ amount: transactions.amount, direction: transactions.direction })
      .from(transactions)
      .where(
        and(
          eq(transactions.branchId, branchId),
          sql`${transactions.occurredAt} >= ${billingMonth}::date
              and ${transactions.occurredAt} < (${billingMonth}::date + interval '1 month')`,
        ),
      ),
    upcomingBirthdays(branchId, 3),
    cashExpense(branchId, from, until),
    cashIncome(branchId, from, until),
  ]);

  // Витрата — за датою видачі, а не за місяцем роботи: аванс за вересень,
  // виданий у вересні, і решта, видана в жовтні, потрапляють у різні місяці.
  const salaryPaid = sumMoney(outgoing.salary, (row) => row.amount);
  const summary = paymentsSummary(childRows);
  const salaryAccrued = sumMoney(staffData.rows, (row) => row.salary);
  const otherExpenses = sumMoney(outgoing.other, (row) => row.amount);
  const otherIncome = sumMoney(
    expenseRows.filter((row) => row.direction === "income"),
    (row) => row.amount,
  );
  // Гроші, що надійшли цього місяця, за датою оплати.
  const cashIn = sumMoney(incoming, (row) => row.amount);

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
    income: { total: cashIn, other: otherIncome },
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
      total: money(salaryPaid + otherExpenses),
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
