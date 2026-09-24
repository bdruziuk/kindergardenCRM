import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  cashOpeningBalances,
  children,
  monthCloses,
  payments,
  salaryPayments,
  staff,
  transactions,
} from "@/db/schema";
import type { PaymentMethod } from "./api-schemas";
import { type CashRow, type DebtInput, type StaffDebt, staffDebt } from "./cash";
import type { MonthSnapshot } from "./month-close";
import { monthStart } from "./period";
import { staffWithAttendance } from "./queries";

/**
 * Читання грошей за фактичними датами.
 *
 * Сторінки місяця питають «скільки нарахували» — це місяць роботи й місяць
 * нарахування плати. Каса питає інше: «скільки грошей пройшло». Друге ніколи
 * не збігається з першим, і саме тому запити тут окремі від тих, що в
 * `queries.ts`: ті групують по `billingMonth` і `month`, ці — по `paidAt` і
 * `occurredAt`.
 */

/** Межі місяця як напіввідкритий проміжок: `from` включно, `until` — ні. */
export function monthRange(month: string) {
  const from = monthStart(month);
  const [year, number] = from.slice(0, 7).split("-").map(Number);
  const nextMonth = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
  return { from, until: `${nextMonth}-01` };
}

export function yearRange(year: number) {
  return { from: `${year}-01-01`, until: `${year + 1}-01-01` };
}

/** Гроші, що надійшли в період: батьківські оплати за датою оплати. */
export async function cashIncome(
  branchId: number,
  from: string,
  until: string,
): Promise<CashRow[]> {
  const db = getDb();
  const [parentRows, otherRows] = await Promise.all([
    db
      .select({
        amount: payments.amount,
        method: payments.method,
        date: payments.paidAt,
      })
      .from(payments)
      // Оплата не має власної філії — вона належить їй через дитину.
      .innerJoin(children, eq(children.id, payments.childId))
      .where(
        and(
          eq(children.branchId, branchId),
          sql`${payments.paidAt} >= ${from}::date and ${payments.paidAt} < ${until}::date`,
        ),
      ),
    db
      .select({
        amount: transactions.amount,
        method: transactions.method,
        date: transactions.occurredAt,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.branchId, branchId),
          eq(transactions.direction, "income"),
          sql`${transactions.occurredAt} >= ${from}::date and ${transactions.occurredAt} < ${until}::date`,
        ),
      ),
  ]);
  return [...parentRows, ...otherRows] as CashRow[];
}

/** Гроші, що вийшли в період: виплати за датою видачі, витрати за датою. */
export async function cashExpense(
  branchId: number,
  from: string,
  until: string,
): Promise<{ salary: CashRow[]; other: (CashRow & { category: string })[] }> {
  const db = getDb();
  const [salaryRows, otherRows] = await Promise.all([
    db
      .select({
        amount: salaryPayments.amount,
        method: salaryPayments.method,
        date: salaryPayments.paidAt,
      })
      .from(salaryPayments)
      .innerJoin(staff, eq(staff.id, salaryPayments.staffId))
      .where(
        and(
          eq(staff.branchId, branchId),
          sql`${salaryPayments.paidAt} >= ${from}::date and ${salaryPayments.paidAt} < ${until}::date`,
        ),
      ),
    db
      .select({
        amount: transactions.amount,
        method: transactions.method,
        date: transactions.occurredAt,
        category: transactions.category,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.branchId, branchId),
          eq(transactions.direction, "expense"),
          sql`${transactions.occurredAt} >= ${from}::date and ${transactions.occurredAt} < ${until}::date`,
        ),
      ),
  ]);
  return {
    salary: salaryRows as CashRow[],
    other: otherRows as (CashRow & { category: string })[],
  };
}

/**
 * Початкові залишки на задану дату.
 *
 * Береться останній запис із датою не пізніше `asOf`, окремо по кожному виду
 * грошей. Домовленість про дату одна й без винятків: залишок описує стан на
 * ранок цього дня, тобто операції самого дня в нього ще не входять і далі
 * додаються рухом. Інакше операція того самого дня рахувалася б двічі.
 */
export async function openingBalances(
  branchId: number,
  asOf: string,
): Promise<Partial<Record<PaymentMethod, number>>> {
  const rows = await getDb()
    .select({
      method: cashOpeningBalances.method,
      amount: cashOpeningBalances.amount,
      asOf: cashOpeningBalances.asOf,
    })
    .from(cashOpeningBalances)
    .where(
      and(
        eq(cashOpeningBalances.branchId, branchId),
        sql`${cashOpeningBalances.asOf} <= ${asOf}::date`,
      ),
    )
    .orderBy(asc(cashOpeningBalances.asOf), asc(cashOpeningBalances.id));

  // Пізніший запис заміщає ранішній: останній на дату й є чинним.
  const latest: Partial<Record<PaymentMethod, number>> = {};
  for (const row of rows) latest[row.method] = row.amount;
  return latest;
}

/**
 * Рух коштів від дати залишку до початку періоду — щоб дістати залишок на
 * початок саме цього місяця, а не на дату, коли залишки вносили.
 */
export async function openingAt(branchId: number, from: string) {
  const base = await getDb()
    .select({ asOf: cashOpeningBalances.asOf })
    .from(cashOpeningBalances)
    .where(
      and(
        eq(cashOpeningBalances.branchId, branchId),
        sql`${cashOpeningBalances.asOf} <= ${from}::date`,
      ),
    )
    .orderBy(asc(cashOpeningBalances.asOf));
  if (!base.length) return { opening: {}, since: null as string | null };

  const since = base[base.length - 1].asOf;
  return { opening: await openingBalances(branchId, since), since };
}

/**
 * Нарахування по місяцях роботи.
 *
 * Закритий місяць віддає своє зі знімка — саме тому борг за минуле не
 * перераховується сьогоднішніми ставками. Відкритий рахується наживо.
 */
async function accrualsByMonth(branchId: number, months: string[]) {
  const db = getDb();
  const closes = await db
    .select({ month: monthCloses.month, data: monthCloses.data })
    .from(monthCloses)
    .where(eq(monthCloses.branchId, branchId));

  const frozen = new Map<string, Map<number, number>>();
  for (const row of closes) {
    const key = row.month.slice(0, 7);
    if (!months.includes(key)) continue;
    try {
      const snapshot = JSON.parse(row.data) as MonthSnapshot;
      const staffRows = (snapshot.staff as { rows?: { id: number; salary: number }[] })?.rows ?? [];
      frozen.set(key, new Map(staffRows.map((person) => [person.id, person.salary])));
    } catch {
      // Пошкоджений знімок не має валити сторінку: місяць просто порахується
      // наживо, і це видно в даних, а не падінням.
    }
  }

  const open = months.filter((month) => !frozen.has(month));
  const live = await Promise.all(
    open.map(async (month) => {
      const { rows } = await staffWithAttendance(branchId, month);
      return [month, new Map(rows.map((person) => [person.id, person.salary]))] as const;
    }),
  );
  for (const [month, map] of live) frozen.set(month, map);
  return frozen;
}

/**
 * Борг по зарплаті на всі місяці одразу.
 *
 * `asOf` рахує борг станом на дату: виплати, зроблені пізніше, до уваги не
 * беруться. Без нього — поточний борг з усіма записаними виплатами.
 */
export async function payrollDebt(
  branchId: number,
  upToMonth: string,
  asOf?: string,
): Promise<StaffDebt[]> {
  const db = getDb();
  const { until } = monthRange(upToMonth);

  const [people, payoutRows, closedRows] = await Promise.all([
    db
      .select({
        id: staff.id,
        name: staff.fullName,
        role: staff.role,
        active: staff.active,
      })
      .from(staff)
      .where(eq(staff.branchId, branchId))
      .orderBy(asc(staff.id)),
    db
      .select({
        staffId: salaryPayments.staffId,
        month: salaryPayments.month,
        amount: salaryPayments.amount,
        method: salaryPayments.method,
        date: salaryPayments.paidAt,
      })
      .from(salaryPayments)
      .innerJoin(staff, eq(staff.id, salaryPayments.staffId))
      .where(
        and(
          eq(staff.branchId, branchId),
          sql`${salaryPayments.month} < ${until}::date`,
        ),
      ),
    db
      .select({ month: monthCloses.month })
      .from(monthCloses)
      .where(
        and(
          eq(monthCloses.branchId, branchId),
          sql`${monthCloses.month} < ${until}::date`,
        ),
      ),
  ]);

  // Цікавлять лише місяці, де щось є: закриті місяці та місяці з виплатами,
  // плюс той, що на екрані. Решту рахувати нема сенсу — там нулі.
  const months = [
    ...new Set([
      ...closedRows.map((row) => row.month.slice(0, 7)),
      ...payoutRows.map((row) => row.month.slice(0, 7)),
      monthStart(upToMonth).slice(0, 7),
    ]),
  ].sort();

  const accruals = await accrualsByMonth(branchId, months);

  const input: DebtInput[] = people.map((person) => ({
    staffId: person.id,
    name: person.name,
    role: person.role,
    active: person.active,
    accruals: months
      .map((month) => ({ month, accrued: accruals.get(month)?.get(person.id) ?? 0 }))
      .filter((row) => row.accrued),
    payouts: payoutRows
      .filter((row) => row.staffId === person.id)
      .map((row) => ({
        month: row.month.slice(0, 7),
        amount: row.amount,
        method: row.method,
        date: row.date,
      })),
  }));

  return staffDebt(input, asOf);
}
