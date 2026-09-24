import { diffMoney, kopecks, money, sumMoney } from "./money";
import { type PaymentMethod, paymentMethodValues } from "./api-schemas";

/**
 * Рух грошей і борг по зарплаті.
 *
 * Тут навмисно немає жодного запиту до бази: усе рахується з переданих рядків.
 * Саме через це правила можна перевірити тестами по сценаріях — «аванс у
 * вересні, решта в жовтні» — не піднімаючи ні сервера, ні бази.
 *
 * Розділення, на якому все тримається:
 *
 * «Нараховано» — за місяць роботи. Його заморожує закриття місяця.
 * «Витрати за період» — за датою, коли гроші справді вийшли.
 * «Ще виплатити» — різниця між ними, порахована по місяцю роботи.
 *
 * Одна виплата бере участь у двох підсумках одночасно й у різних місяцях:
 * зарплата за вересень, видана 5 жовтня, гасить вересневий борг, але є
 * жовтневою витратою. Саме тому обидві дати треба тримати окремо.
 */

export type CashRow = {
  amount: number;
  method: PaymentMethod;
  /** Дата, коли гроші справді рухалися. */
  date: string;
};

export type MethodFlow = {
  method: PaymentMethod;
  opening: number;
  income: number;
  expense: number;
  /** Рух за період: скільки додалося або пішло. */
  net: number;
  /** Залишок на кінець: початок + доходи − витрати. */
  closing: number;
};

const inPeriod = (date: string, from: string, until: string) =>
  date >= from && date < until;

/** Рядки, що потрапили в період за своєю фактичною датою. */
export const rowsInPeriod = <T extends { date: string }>(
  rows: readonly T[],
  from: string,
  until: string,
) => rows.filter((row) => inPeriod(row.date, from, until));

/**
 * Залишки по видах грошей.
 *
 * `opening` задають вручну — вивести його з операцій неможливо, бо до першого
 * запису в системі каса вже була не порожня. Поки залишків не внесли, сюди
 * приходять нулі, і сторінка має назвати це рухом коштів, а не залишком.
 */
export function methodFlows(
  income: readonly CashRow[],
  expense: readonly CashRow[],
  opening: Partial<Record<PaymentMethod, number>> = {},
): MethodFlow[] {
  return paymentMethodValues.map((method) => {
    const gets = sumMoney(income.filter((row) => row.method === method), (row) => row.amount);
    const pays = sumMoney(expense.filter((row) => row.method === method), (row) => row.amount);
    const start = money(opening[method] ?? 0);
    return {
      method,
      opening: start,
      income: gets,
      expense: pays,
      net: diffMoney(gets, pays),
      closing: money(start + diffMoney(gets, pays)),
    };
  });
}

export type PayrollMonth = {
  month: string;
  accrued: number;
  paid: number;
  /** Додатне — ще винні працівникові. */
  remaining: number;
  /** Додатне — видали більше, ніж нарахували. */
  overpaid: number;
};

/**
 * Борг за один місяць роботи для однієї людини.
 *
 * `asOf` обмежує виплати тими, що були зроблені не пізніше цієї дати: так
 * рахується борг «станом на 30 вересня», який пізніша жовтнева виплата вже
 * не має права змінювати заднім числом.
 */
export function payrollMonth(
  month: string,
  accrued: number,
  payouts: readonly CashRow[],
  asOf?: string,
): PayrollMonth {
  const counted = asOf ? payouts.filter((row) => row.date <= asOf) : payouts;
  const paid = sumMoney(counted, (row) => row.amount);
  const balance = diffMoney(accrued, paid);
  return {
    month,
    accrued: money(accrued),
    paid,
    // Переплата одному не гасить борг перед іншим і не переноситься на інший
    // місяць сама собою, тож ці дві величини рахуються окремо й ніколи не
    // згортаються в одне число зі знаком.
    remaining: balance > 0 ? balance : 0,
    overpaid: balance < 0 ? -balance : 0,
  };
}

export type StaffDebt = {
  staffId: number;
  name: string;
  role: string;
  active: boolean;
  months: PayrollMonth[];
  remaining: number;
  overpaid: number;
};

export type DebtInput = {
  staffId: number;
  name: string;
  role: string;
  active: boolean;
  /** Нараховано по місяцях роботи: те, що заморожене закриттям. */
  accruals: readonly { month: string; accrued: number }[];
  /** Виплати з місяцем роботи, який вони гасять, і датою видачі. */
  payouts: readonly (CashRow & { month: string })[];
};

/**
 * Борг по всіх місяцях, по кожній людині окремо.
 *
 * Підсумок складається лише з боргів. Переплата одній людині не зменшує того,
 * що винні іншій, — інакше загальна сума показувала б менше, ніж доведеться
 * віддати.
 */
export function staffDebt(people: readonly DebtInput[], asOf?: string): StaffDebt[] {
  return people
    .map((person) => {
      const months = [
        ...new Set([
          ...person.accruals.map((row) => row.month),
          ...person.payouts.map((row) => row.month),
        ]),
      ]
        .sort()
        .map((month) =>
          payrollMonth(
            month,
            person.accruals.find((row) => row.month === month)?.accrued ?? 0,
            person.payouts.filter((row) => row.month === month),
            asOf,
          ),
        )
        .filter((row) => row.accrued || row.paid);
      return {
        staffId: person.staffId,
        name: person.name,
        role: person.role,
        active: person.active,
        months,
        remaining: sumMoney(months, (row) => row.remaining),
        overpaid: sumMoney(months, (row) => row.overpaid),
      };
    })
    .filter((person) => person.months.length)
    .sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name, "uk"));
}

/** Загальний борг садочка: сума боргів, без взаємозаліку з переплатами. */
export const totalDebt = (rows: readonly StaffDebt[]) =>
  sumMoney(rows, (row) => row.remaining);

export const totalOverpaid = (rows: readonly StaffDebt[]) =>
  sumMoney(rows, (row) => row.overpaid);

/** Чи внесені початкові залишки — від цього залежить підпис на сторінці. */
export const hasOpening = (flows: readonly MethodFlow[]) =>
  flows.some((flow) => kopecks(flow.opening) !== 0);
