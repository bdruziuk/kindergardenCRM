import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, fixture, database, ScopeError } from "./test-helpers.mjs";

// Виправлення виплати зі сторінки фінансів: місяць роботи тепер можна
// змінити, але тільки явно, і лише поки фінансовий місяць відкритий.

const period = load("lib/period.ts", { "./api-schemas": schemas });

function setup(closedMonth) {
  const data = fixture();
  // Аванс видали 6 жовтня, а записали за серпень — випадок із проду.
  data.salaryPayments.push({ id: 13, staffId: 1, month: "2026-08-01", kind: "advance", amount: 1000, method: "cash", paidAt: "2026-10-06", note: null });
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
  const closes = load("lib/month-close.ts", {
    "drizzle-orm": orm, "@/db": db, "@/db/schema": tables, "./period": period, "./scope": scope,
  });
  const payouts = load("lib/payouts.ts", {
    "drizzle-orm": orm, "@/db": db, "@/db/schema": tables, "./period": period, "./scope": scope, "./month-close": closes,
  });
  const { POST } = load("app/api/finances/route.ts", {
    "drizzle-orm": orm, "@/db": db, "@/db/schema": tables,
    "@/lib/api-schemas": schemas, "@/lib/period": period,
    "@/lib/scope": scope, "@/lib/month-close": closes, "@/lib/payouts": payouts,
    "@/lib/snapshots": { financeSnapshot: async () => ({}) },
  });
  const post = (body) => POST(new Request("http://localhost/api/finances", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ month: "2026-10", ...body }),
  }));
  const payout = () => data.salaryPayments.find((row) => row.id === 13);
  return { post, payout };
}

const edit = { kind: "payout_update", payoutId: 13, payoutKind: "advance", amount: 1000, method: "cash", paidAt: "2026-10-06", note: "" };

test("A payout's payroll month can be corrected", async () => {
  const { post, payout } = setup();
  const response = await post({ ...edit, payrollMonth: "2026-10" });
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(payout().month, "2026-10-01");
});

test("Without a payroll month the old one stays", async () => {
  const { post, payout } = setup();
  assert.equal((await post({ ...edit, amount: 900 })).status, 200);
  assert.equal(payout().month, "2026-08-01");
  assert.equal(payout().amount, 900);
});

test("A closed payroll month does not block the correction", async () => {
  const { post, payout } = setup("2026-08");
  assert.equal((await post({ ...edit, payrollMonth: "2026-10" })).status, 200);
  assert.equal(payout().month, "2026-10-01");
});

test("A payout in a closed financial month cannot be changed or removed", async () => {
  const { post, payout } = setup("2026-10");
  assert.equal((await post({ ...edit, payrollMonth: "2026-10" })).status, 409);
  assert.equal((await post({ kind: "payout_remove", payoutId: 13 })).status, 409);
  assert.equal(payout().month, "2026-08-01");
});

test("A payout can be removed", async () => {
  const { post, payout } = setup();
  assert.equal((await post({ kind: "payout_remove", payoutId: 13 })).status, 200);
  assert.equal(payout(), undefined);
});
