import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, fixture, database, ScopeError } from "./test-helpers.mjs";

const period = load("lib/period.ts", { "./api-schemas": schemas });
const receipt = { name: "receipt.pdf", dataUrl: "data:application/pdf;base64,YQ==" };
function setup(closedMonth, recordMonth = "2026-08") {
  const data = fixture();
  data.lessons[0].workDate = `${recordMonth}-02`;
  data.staffAttendance[0].workDate = `${recordMonth}-02`;
  data.payments.push({ id: 1, childId: 1, billingMonth: `${recordMonth}-01`, amount: 1000 });
  data.paymentReceipts.push({ id: 1, paymentId: 1, fileName: "old.pdf" });
  data.salaryPayments.push({ id: 1, staffId: 1, month: `${recordMonth}-01`, paidAt: "2026-09-03", amount: 1000 });
  data.transactions.push({ id: 1, branchId: 1, occurredAt: `${recordMonth}-02`, amount: 1000 });
  if (closedMonth) data.monthCloses.push({
    id: 1, branchId: 1, month: `${closedMonth}-01`,
    data: JSON.stringify({ payments: {}, staff: {}, finances: {} }), closedAt: new Date(),
  });
  const db = { getDb: () => database(data) };
  const scope = {
    ScopeError, resolveScope: async () => ({ branchId: 1 }),
    scopeFailure: (error) => error instanceof ScopeError
      ? Response.json({ error: error.message }, { status: error.status }) : null,
  };
  // Use the real period resolution, close lookup, and payout mutation code.
  const closes = load("lib/month-close.ts", {
    "drizzle-orm": orm, "@/db": db, "@/db/schema": tables,
    "./period": period, "./scope": scope,
  });
  const payouts = load("lib/payouts.ts", {
    "drizzle-orm": orm, "@/db": db, "@/db/schema": tables,
    "./period": period, "./scope": scope, "./month-close": closes,
  });
  const mocks = {
    "drizzle-orm": orm, "@/db": db, "@/db/schema": tables,
    "@/lib/api-schemas": schemas, "@/lib/period": period,
    "@/lib/scope": scope, "@/lib/month-close": closes, "@/lib/payouts": payouts,
    "@/lib/snapshots": { staffSnapshot: async () => ({}), financeSnapshot: async () => ({}) },
    "@/lib/queries": { childrenWithPayments: async () => [], paymentsSummary: () => ({}) },
  };
  return { data, post: (route) => load(`app/api/${route}/route.ts`, mocks).POST };
}
const cases = [
  ["finances", { kind: "add", direction: "income", category: "Other income", amount: 100, method: "iban" }, "occurredAt"],
  ["payments", { kind: "remove", paymentId: 1 }],
  ["payments", { kind: "receipt_set", paymentId: 1, receipt }],
  ["payments", { kind: "receipt_remove", paymentId: 1 }],
  ["finances", { kind: "add", category: "Food", amount: 100, method: "cash" }, "occurredAt"],
  ["finances", { kind: "remove", transactionId: 1 }],
  ["staff", { kind: "attendance", staffId: 1, state: "absent" }, "date"],
  ["staff", { kind: "attendance", staffId: 1, state: "unmarked" }, "date"],
  ["staff", { kind: "lesson_add", staffId: 1, note: "New lesson" }, "date"],
  ["staff", { kind: "lesson_note", lessonId: 1, note: "Changed" }],
  ["staff", { kind: "lesson_remove", lessonId: 1 }],
];
async function request(post, route, body) {
  const response = await post(route)(new Request(`http://localhost/api/${route}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}
for (const [route, action, dateField] of cases) {
  for (const closed of [true, false]) {
    test(`${route}/${action.kind}/${action.state ?? ""}: actual month ${closed ? "closed" : "open"}, submitted month open`, async () => {
      const { data, post } = setup(closed ? "2026-08" : null);
      const before = structuredClone(data);
      const result = await request(post, route, {
        ...action, month: "2026-09", ...(dateField ? { [dateField]: "2026-08-02" } : {}),
      });
      assert.equal(result.status, closed ? 409 : 200, JSON.stringify(result.body));
      if (closed) assert.deepEqual(data, before);
      else assert.notDeepEqual(data, before);
    });
  }
  if (route !== "payments") test(`${route}/${action.kind}/${action.state ?? ""}: omitted month cannot bypass closed July`, async () => {
    const { data, post } = setup("2026-07", "2026-07");
    const before = structuredClone(data);
    const result = await request(post, route, {
      ...action, ...(dateField ? { [dateField]: "2026-07-02" } : {}),
    });
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.deepEqual(data, before);
  });
}
// A parent payment belongs to the month it is billed for, whatever day the
// money changed hands.
for (const closed of [true, false]) test("payments: new payment uses billing month", async () => {
  const { data, post } = setup("2026-08");
  const before = structuredClone(data);
  const result = await request(post, "payments", {
    kind: "add", childId: 1, amount: 100, method: "cash",
    month: closed ? "2026-08" : "2026-09",
    paidAt: closed ? "2026-09-03" : "2026-08-03",
  });
  assert.equal(result.status, closed ? 409 : 200, JSON.stringify(result.body));
  if (closed) assert.deepEqual(data, before);
  else assert.notDeepEqual(data, before);
});

/**
 * Виплати мають власне правило, і воно інше.
 *
 * Закритий місяць роботи заморожує табель і нарахування — але не забороняє
 * платити за цей місяць далі: зарплату за вересень видають у жовтні, і це
 * звичайна робота садочка. Забороняє лише закритий фінансовий місяць, бо тоді
 * змінювалася б уже здана каса.
 *
 * У фікстурі виплата за серпень (`month`) видана 3 вересня (`paidAt`), тож ці
 * два місяці можна закривати незалежно й бачити різницю.
 */
for (const route of ["staff", "finances"]) {
  test(`${route}: за закритий місяць роботи можна виплатити у відкритому місяці`, async () => {
    const { data, post } = setup("2026-08");
    const result = await request(post, route, {
      kind: "payout_add", staffId: 1, payoutKind: "salary", amount: 12000,
      method: "cash", month: "2026-08", paidAt: "2026-09-05",
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const added = data.salaryPayments.find((row) => row.amount === 12000);
    // Місяць роботи лишається серпневим: виплата гасить саме серпневий борг.
    assert.equal(added.month, "2026-08-01");
    assert.equal(added.paidAt, "2026-09-05");
  });

  test(`${route}: у закритий фінансовий місяць виплату не записати`, async () => {
    const { data, post } = setup("2026-09");
    const before = structuredClone(data);
    const result = await request(post, route, {
      kind: "payout_add", staffId: 1, payoutKind: "salary", amount: 12000,
      method: "cash", month: "2026-10", paidAt: "2026-09-05",
    });
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.deepEqual(data, before);
  });

  test(`${route}: правити виплату з закритого фінансового місяця не можна`, async () => {
    const { data, post } = setup("2026-09");
    const before = structuredClone(data);
    // Місяць у тілі запиту вказує на відкритий період — обійти перевірку ним
    // не вийде, бо дата береться з бази.
    for (const body of [
      { kind: "payout_update", payoutId: 1, payoutKind: "salary", amount: 1500, method: "cash", paidAt: "2026-09-04", month: "2026-10" },
      { kind: "payout_remove", payoutId: 1, month: "2026-10" },
    ]) {
      const result = await request(post, route, body);
      assert.equal(result.status, 409, JSON.stringify(result.body));
    }
    assert.deepEqual(data, before);
  });

  test(`${route}: закритий місяць роботи не заважає правити виплату`, async () => {
    const { data, post } = setup("2026-08");
    const result = await request(post, route, {
      kind: "payout_update", payoutId: 1, payoutKind: "salary",
      amount: 1500, method: "cash", paidAt: "2026-09-04",
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(data.salaryPayments[0].amount, 1500);
    // Місяць роботи мовчки не змінюється.
    assert.equal(data.salaryPayments[0].month, "2026-08-01");
  });

  test(`${route}: перенести виплату в закритий місяць не можна`, async () => {
    const { data, post } = setup("2026-07");
    const before = structuredClone(data);
    const result = await request(post, route, {
      kind: "payout_update", payoutId: 1, payoutKind: "salary",
      amount: 1000, method: "cash", paidAt: "2026-07-15",
    });
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.deepEqual(data, before);
  });

  test(`${route}: повторний запит не створює другу таку саму виплату`, async () => {
    const { data, post } = setup(null);
    const body = {
      kind: "payout_add", staffId: 1, payoutKind: "advance", amount: 8000,
      method: "cash", month: "2026-09", paidAt: "2026-09-20",
    };
    assert.equal((await request(post, route, body)).status, 200);
    assert.equal((await request(post, route, body)).status, 200);
    assert.equal(data.salaryPayments.filter((row) => row.amount === 8000).length, 1);
  });

  test(`${route}: чужу виплату не чіпає ні правка, ні видалення`, async () => {
    const { data, post } = setup(null);
    data.salaryPayments.push({ id: 2, staffId: 2, month: "2026-09-01", paidAt: "2026-09-10", amount: 500 });
    const before = structuredClone(data);
    for (const body of [
      { kind: "payout_update", payoutId: 2, payoutKind: "salary", amount: 9999, method: "cash", paidAt: "2026-09-11" },
      { kind: "payout_remove", payoutId: 2 },
    ]) {
      const result = await request(post, route, body);
      assert.equal(result.status, 403, JSON.stringify(result.body));
    }
    assert.deepEqual(data, before);
  });
}
