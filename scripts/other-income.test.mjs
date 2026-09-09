import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, orm, tables, fixture, database, ScopeError } from "./test-helpers.mjs";
const period = load("lib/period.ts", { "./api-schemas": schemas });
for (const method of ["cash", "card", "iban"]) {
  test(`Other income increases ${method} balance without inflating expenses`, async () => {
    const rows = [
      { id: 1, direction: "income", amount: 600, method, category: "Extra" },
      { id: 2, direction: "expense", amount: 100, method, category: "Rent" },
      { id: 3, amount: 50, method, category: "Legacy expense" },
    ];
    const { financeSnapshot } = load("lib/snapshots.ts", {
      "drizzle-orm": orm, "@/db": {}, "@/db/schema": tables,
      "@/lib/api-schemas": schemas, "@/lib/format": {}, "@/lib/period": period,
      "@/lib/queries": {
        childrenWithPayments: async () => [{ history: [{ method, amount: 1000 }] }],
        paymentsSummary: () => ({ received: 1000 }),
        monthExpenses: async () => rows,
        salaryProgress: async () => [{ accrued: 300, paid: 200, payouts: [{ method, amount: 200 }] }],
      },
    });
    const result = await financeSnapshot(1, "2026-09");
    assert.equal(result.summary.income, 1600);
    assert.equal(result.summary.otherIncome, 600);
    assert.equal(result.summary.expense.total, 350);
    assert.equal(result.summary.balance, 1250);
    assert.deepEqual(result.methods.find((row) => row.method === method), { method, income: 1600, expense: 350, balance: 1250 });
    assert.equal(result.categories.some((row) => row.category === "Extra"), false);
    rows.shift();
    assert.equal((await financeSnapshot(1, "2026-09")).summary.income, 1000);
  });
  test(`API saves income with ${method} and assigned branch`, async () => {
    const data = fixture();
    const { POST } = load("app/api/finances/route.ts", {
      "drizzle-orm": orm, "@/db": { getDb: () => database(data) }, "@/db/schema": tables,
      "@/lib/api-schemas": schemas, "@/lib/period": period, "@/lib/payouts": {},
      "@/lib/month-close": { assertMonthOpen: async () => {} },
      "@/lib/snapshots": { financeSnapshot: async () => ({}) },
      "@/lib/scope": { ScopeError, resolveScope: async () => ({ branchId: 1 }), scopeFailure: () => null },
    });
    const response = await POST(new Request("http://localhost/api/finances", {
      method: "POST", body: JSON.stringify({ kind: "add", direction: "income", category: "Extra", amount: 600, method, occurredAt: "2026-09-09", month: "2026-09", branchId: 99 }),
    }));
    assert.equal(response.status, 200);
    assert.equal(data.transactions[0].direction, "income");
    assert.equal(data.transactions[0].branchId, 1);
    assert.equal(data.transactions[0].method, method);
  });
}
test("Legacy adds remain expenses and invalid direction is rejected", () => {
  const base = { kind: "add", category: "Rent", amount: 10, method: "cash", occurredAt: "2026-09-09" };
  assert.equal(schemas.transactionRequest.parse(base).direction, "expense");
  assert.equal(schemas.transactionRequest.safeParse({ ...base, direction: "invalid" }).success, false);
});
test("Reports include other income in monthly and yearly totals", async () => {
  for (const query of ["month=2026-09", "year=2026"]) {
    const directions = [];
    const reportOrm = { ...orm, eq: (a, b) => { if (a === tables.transactions.direction) directions.push(b); return orm.eq(a, b); } };
    const results = [[{ month: "2026-09", total: 600 }], [{ month: "2026-09", total: 1000 }], [], [{ month: "2026-09", total: 100 }], [], [], [], [], []];
    const db = { select: () => {
      const rows = results.shift();
      const chain = { from: () => chain, where: () => chain, groupBy: () => chain, orderBy: () => chain, innerJoin: () => chain, leftJoin: () => chain, then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) };
      return chain;
    } };
    const { GET } = load("app/api/reports/route.ts", {
      "drizzle-orm": reportOrm, "@/db": { getDb: () => db }, "@/db/schema": { ...tables, waitlist: {} },
      "@/lib/api-schemas": schemas, "@/lib/month-close": { loadClose: async () => null },
      "@/lib/queries": { staffWithAttendance: async () => ({ rows: [] }) },
      "@/lib/scope": { resolveScope: async () => ({ branchId: 1 }), scopeFailure: () => null },
    });
    const response = await GET(new Request(`http://localhost/api/reports?${query}`));
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.deepEqual(directions, ["income", "expense", "expense"]);
    assert.equal(report.totals.income, 1600);
    assert.equal(report.totals.expenses, 100);
    assert.equal(report.totals.balance, 1500);
  }
});

test("Dashboard includes other income without changing parent debt or expense totals", async () => {
  const db = { select: (selection) => {
    const rows = Object.hasOwn(selection, "activeChildren") ? [{ activeChildren: 1, groupCount: 1 }] : [{ direction: "income", amount: 600 }, { direction: "expense", amount: 100 }];
    const chain = { from: () => chain, where: () => chain, then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject) };
    return chain;
  } };
  const { dashboardSnapshot } = load("lib/snapshots.ts", {
    "drizzle-orm": orm, "@/db": { getDb: () => db }, "@/db/schema": tables,
    "@/lib/api-schemas": schemas, "@/lib/period": period, "@/lib/format": {},
    "@/lib/queries": {
      childrenWithPayments: async () => [],
      paymentsSummary: () => ({ received: 1000, balance: 400, partialCount: 1, unpaidCount: 0 }),
      staffWithAttendance: async () => ({ rows: [], info: { workdays: 22 } }),
      upcomingBirthdays: async () => [],
    },
  });
  const result = await dashboardSnapshot(1, "2026-09");
  assert.deepEqual(result.income, { total: 1600, other: 600 });
  assert.equal(result.payments.balance, 400);
  assert.equal(result.expenses.total, 100);
});
