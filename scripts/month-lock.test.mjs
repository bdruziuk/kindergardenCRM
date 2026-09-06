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
  ...["staff", "finances"].flatMap((route) => [
    [route, { kind: "payout_remove", payoutId: 1 }],
    [route, { kind: "payout_update", payoutId: 1, payoutKind: "salary", amount: 1500, method: "cash", paidAt: "2026-09-04" }],
  ]),
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
// New payments/payouts belong to their billing month, not the cash transfer date.
for (const route of ["payments", "staff", "finances"]) {
  for (const closed of [true, false]) test(`${route}: new payment uses billing month`, async () => {
    const { data, post } = setup("2026-08");
    const before = structuredClone(data);
    const body = route === "payments"
      ? { kind: "add", childId: 1 }
      : { kind: "payout_add", staffId: 1, payoutKind: "salary" };
    const result = await request(post, route, {
      ...body, amount: 100, method: "cash", month: closed ? "2026-08" : "2026-09",
      paidAt: closed ? "2026-09-03" : "2026-08-03",
    });
    assert.equal(result.status, closed ? 409 : 200, JSON.stringify(result.body));
    if (closed) assert.deepEqual(data, before);
    else assert.notDeepEqual(data, before);
  });
}
