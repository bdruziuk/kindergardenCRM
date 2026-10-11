import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, fixture, database, ScopeError } from "./test-helpers.mjs";

// Вирахування із зарплати за місяць: вносить власник або керуючий, лише своїм
// працівникам; нуль прибирає вирахування.

const staffDeductions = {
  tableName: "staffDeductions",
  ...Object.fromEntries(["id", "staffId", "month", "amount", "note"].map((key) => [key, { table: "staffDeductions", key }])),
};

function setup({ canManageBranch = true } = {}) {
  const data = { ...fixture(), staffDeductions: [] };
  const { POST } = load("app/api/staff/route.ts", {
    "drizzle-orm": orm,
    "@/db": { getDb: () => database(data) },
    "@/db/schema": { ...tables, staffDeductions },
    "@/lib/api-schemas": schemas,
    "@/lib/period": { currentMonth: () => "2026-10", monthStart: (month) => `${month}-01` },
    "@/lib/month-close": { assertMonthOpen: async () => {} },
    "@/lib/payouts": {},
    "@/lib/snapshots": { staffSnapshot: async () => ({ rows: [] }) },
    "@/lib/scope": {
      ScopeError, resolveScope: async () => ({ branchId: 1, canManageBranch }),
      scopeFailure: (error) => error instanceof ScopeError ? Response.json({ error: error.message }, { status: error.status }) : null,
    },
  });
  const set = (staffId, amount, note = "") => POST(new Request("http://localhost/api/staff", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "deduction_set", staffId, amount, note, month: "2026-09" }),
  }));
  return { data, set };
}

test("A manager records a deduction for the month", async () => {
  const { data, set } = setup();
  const response = await set(1, 1500, "Штраф");
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.deepEqual(
    data.staffDeductions.map(({ staffId, month, amount, note }) => ({ staffId, month, amount, note })),
    [{ staffId: 1, month: "2026-09-01", amount: 1500, note: "Штраф" }],
  );
});

test("Saving again changes the same month's deduction instead of adding one", async () => {
  const { data, set } = setup();
  await set(1, 1500);
  assert.equal((await set(1, 800, "Менше")).status, 200);
  assert.equal(data.staffDeductions.length, 1);
  assert.equal(data.staffDeductions[0].amount, 800);
  assert.equal(data.staffDeductions[0].note, "Менше");
});

test("Zero removes the deduction", async () => {
  const { data, set } = setup();
  await set(1, 1500);
  assert.equal((await set(1, 0)).status, 200);
  assert.equal(data.staffDeductions.length, 0);
});

test("A teacher cannot record a deduction", async () => {
  const { data, set } = setup({ canManageBranch: false });
  assert.equal((await set(1, 1500)).status, 403);
  assert.equal(data.staffDeductions.length, 0);
});

test("Staff of another branch are not found", async () => {
  const { data, set } = setup();
  assert.equal((await set(2, 1500)).status, 404);
  assert.equal(data.staffDeductions.length, 0);
});

test("A negative amount is refused", async () => {
  const { data, set } = setup();
  assert.equal((await set(1, -5)).status, 400);
  assert.equal(data.staffDeductions.length, 0);
});
