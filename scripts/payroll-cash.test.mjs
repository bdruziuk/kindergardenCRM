import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas } from "./test-helpers.mjs";

const money = load("lib/money.ts");
const cash = load("lib/cash.ts", { "./money": money, "./api-schemas": schemas });

const pay = (amount, date, method = "cash", month = "2026-09") => ({
  amount,
  date,
  method,
  month,
});

/* --- Сценарій 1: аванс у вересні, решта в жовтні ------------------------ */

test("Вересневий аванс і жовтнева доплата лягають у свої місяці", () => {
  const payouts = [pay(8000, "2026-09-20"), pay(12000, "2026-10-05")];

  // Витрати періоду — за датою видачі.
  const september = cash.rowsInPeriod(payouts, "2026-09-01", "2026-10-01");
  const october = cash.rowsInPeriod(payouts, "2026-10-01", "2026-11-01");
  assert.equal(money.sumMoney(september, (row) => row.amount), 8000);
  assert.equal(money.sumMoney(october, (row) => row.amount), 12000);

  // Борг станом на 30 вересня бачить лише вересневу виплату.
  const atSeptemberEnd = cash.payrollMonth("2026-09", 20000, payouts, "2026-09-30");
  assert.equal(atSeptemberEnd.remaining, 12000);

  // Поточний борг після жовтневої доплати — нуль, нарахування не змінилося.
  const now = cash.payrollMonth("2026-09", 20000, payouts);
  assert.equal(now.remaining, 0);
  assert.equal(now.paid, 20000);
  assert.equal(now.accrued, 20000);
});

test("Пізніша виплата не переписує борг станом на минулу дату", () => {
  const before = cash.payrollMonth("2026-09", 20000, [pay(8000, "2026-09-20")], "2026-09-30");
  const after = cash.payrollMonth(
    "2026-09",
    20000,
    [pay(8000, "2026-09-20"), pay(12000, "2026-10-05")],
    "2026-09-30",
  );
  assert.equal(before.remaining, after.remaining);
  assert.equal(after.remaining, 12000);
});

/* --- Сценарій 5: грудень виплачений у січні ----------------------------- */

test("Грудневу зарплату, видану в січні, рахує січень наступного року", () => {
  const payouts = [pay(15000, "2027-01-10", "cash", "2026-12")];
  assert.equal(cash.rowsInPeriod(payouts, "2026-01-01", "2027-01-01").length, 0);
  assert.equal(cash.rowsInPeriod(payouts, "2027-01-01", "2028-01-01").length, 1);

  // Місяць роботи лишається грудневим, тож борг гаситься саме за грудень.
  const december = cash.payrollMonth("2026-12", 15000, payouts);
  assert.equal(december.remaining, 0);
  assert.equal(december.accrued, 15000);
});

/* --- Сценарій 6: частковість, переплата, кілька людей -------------------- */

test("Переплата одному не гасить борг перед іншим", () => {
  const rows = cash.staffDebt([
    {
      staffId: 1,
      name: "Ганна",
      role: "Вихователь",
      active: true,
      accruals: [{ month: "2026-09", accrued: 10000 }],
      payouts: [pay(12000, "2026-09-20")],
    },
    {
      staffId: 2,
      name: "Богдан",
      role: "Кухар",
      active: true,
      accruals: [{ month: "2026-09", accrued: 10000 }],
      payouts: [],
    },
  ]);
  assert.equal(cash.totalDebt(rows), 10000);
  assert.equal(cash.totalOverpaid(rows), 2000);
  const overpaidPerson = rows.find((row) => row.staffId === 1);
  assert.equal(overpaidPerson.remaining, 0);
  assert.equal(overpaidPerson.overpaid, 2000);
});

test("Переплата за один місяць не переноситься на інший сама собою", () => {
  const [person] = cash.staffDebt([
    {
      staffId: 1,
      name: "Ганна",
      role: "Вихователь",
      active: true,
      accruals: [
        { month: "2026-08", accrued: 10000 },
        { month: "2026-09", accrued: 10000 },
      ],
      payouts: [pay(13000, "2026-08-20", "cash", "2026-08")],
    },
  ]);
  assert.equal(person.remaining, 10000);
  assert.equal(person.overpaid, 3000);
  assert.equal(person.months.find((row) => row.month === "2026-08").overpaid, 3000);
  assert.equal(person.months.find((row) => row.month === "2026-09").remaining, 10000);
});

test("Кілька часткових виплат складаються без втрати копійок", () => {
  const payouts = Array.from({ length: 3 }, () => pay(0.1, "2026-09-10"));
  const row = cash.payrollMonth("2026-09", 0.3, payouts);
  assert.equal(row.paid, 0.3);
  assert.equal(row.remaining, 0);
  assert.equal(row.overpaid, 0);
});

test("«Остаточна» виплата гасить лише внесену суму", () => {
  const row = cash.payrollMonth("2026-09", 20000, [pay(5000, "2026-09-25")]);
  assert.equal(row.remaining, 15000);
});

/* --- Сценарій 3: звільнений працівник ----------------------------------- */

test("Звільнений працівник із боргом лишається у списку", () => {
  const rows = cash.staffDebt([
    {
      staffId: 7,
      name: "Олена",
      role: "Няня",
      active: false,
      accruals: [{ month: "2026-09", accrued: 9000 }],
      payouts: [pay(4000, "2026-09-20")],
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].active, false);
  assert.equal(rows[0].remaining, 5000);
});

test("Людина без нарахувань і без виплат у список боргів не потрапляє", () => {
  const rows = cash.staffDebt([
    { staffId: 3, name: "Ніна", role: "Кухар", active: true, accruals: [], payouts: [] },
  ]);
  assert.equal(rows.length, 0);
});

/* --- Сценарій 8: залишки по видах грошей -------------------------------- */

test("Залишок = початок + доходи − витрати, по кожному виду окремо", () => {
  const income = [
    { amount: 5000, method: "cash", date: "2026-09-03" },
    { amount: 7000, method: "card", date: "2026-09-04" },
  ];
  const expense = [
    { amount: 8000, method: "cash", date: "2026-09-20" },
    { amount: 1000, method: "iban", date: "2026-09-21" },
  ];
  const flows = cash.methodFlows(income, expense, { cash: 4000, card: 0, iban: 500 });
  const byMethod = Object.fromEntries(flows.map((flow) => [flow.method, flow]));

  assert.equal(byMethod.cash.closing, 1000); // 4000 + 5000 − 8000
  assert.equal(byMethod.card.closing, 7000);
  assert.equal(byMethod.iban.closing, -500); // 500 + 0 − 1000
  // Початковий залишок не є доходом.
  assert.equal(byMethod.cash.income, 5000);
});

test("Без внесених залишків рахується лише рух коштів", () => {
  const flows = cash.methodFlows(
    [{ amount: 1000, method: "cash", date: "2026-09-01" }],
    [],
  );
  assert.equal(cash.hasOpening(flows), false);
  const withOpening = cash.methodFlows([], [], { cash: 100 });
  assert.equal(cash.hasOpening(withOpening), true);
});

/* --- Копійки ------------------------------------------------------------ */

test("Суми не накопичують похибку з комою", () => {
  assert.equal(money.sumMoney([{ a: 0.1 }, { a: 0.2 }], (row) => row.a), 0.3);
  assert.equal(money.diffMoney(0.3, 0.1), 0.2);
  assert.equal(
    money.sumMoney(Array.from({ length: 10 }, () => ({ a: 0.1 })), (row) => row.a),
    1,
  );
});

/* --- межі місяця й року -------------------------------------------------- */

const cashQueries = load("lib/cash-queries.ts", {
  "drizzle-orm": {}, "@/db": {}, "@/db/schema": {},
  "./cash": cash, "./money": money, "./period": { monthStart: (m) => `${m}-01` },
  "./queries": {}, "./month-close": {},
});

test("Межі місяця напіввідкриті й переходять через рік", () => {
  assert.deepEqual(cashQueries.monthRange("2026-09"), {
    from: "2026-09-01",
    until: "2026-10-01",
  });
  // Грудень закінчується січнем наступного року, а не тринадцятим місяцем.
  assert.deepEqual(cashQueries.monthRange("2026-12"), {
    from: "2026-12-01",
    until: "2027-01-01",
  });
  assert.deepEqual(cashQueries.yearRange(2026), {
    from: "2026-01-01",
    until: "2027-01-01",
  });
});

test("Виплата 31 грудня належить грудню, а 1 січня — вже січню", () => {
  const december = cashQueries.monthRange("2026-12");
  const january = cashQueries.monthRange("2027-01");
  const payouts = [
    { amount: 100, method: "cash", date: "2026-12-31", month: "2026-12" },
    { amount: 200, method: "cash", date: "2027-01-01", month: "2026-12" },
  ];
  assert.equal(
    money.sumMoney(cash.rowsInPeriod(payouts, december.from, december.until), (row) => row.amount),
    100,
  );
  assert.equal(
    money.sumMoney(cash.rowsInPeriod(payouts, january.from, january.until), (row) => row.amount),
    200,
  );
});
