import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, fixture, database, ScopeError } from "./test-helpers.mjs";

// Примітка до оплати дитини: задається під час внесення, дописується й
// змінюється потім, видна в історії оплат — і лише в межах своєї філії.

const period = load("lib/period.ts", { "./api-schemas": schemas });
const withNote = { ...tables, payments: { ...tables.payments, note: { table: "payments", key: "note" } } };

function setup() {
  const data = fixture();
  Object.assign(data.children[0], { status: "active", feeMode: "monthly", customFee: 1000 });
  Object.assign(data.children[1], { status: "active", feeMode: "monthly", customFee: 1000 });
  data.payments.push(
    { id: 5, childId: 2, billingMonth: "2026-10-01", purpose: "tuition", amount: 500, method: "cash", paidAt: "2026-10-02", note: null },
  );
  const db = { getDb: () => database(data) };
  const queries = load("lib/queries.ts", {
    "drizzle-orm": orm, "@/db": db, "@/db/schema": withNote,
    "./period": period, "./format": { initialsOf: () => "C" },
  });
  const { POST } = load("app/api/payments/route.ts", {
    "drizzle-orm": orm, "@/db": db, "@/db/schema": withNote,
    "@/lib/api-schemas": schemas, "@/lib/period": period,
    "@/lib/month-close": { assertMonthOpen: async () => {}, loadClose: async () => null },
    "@/lib/queries": queries,
    "@/lib/scope": {
      ScopeError, resolveScope: async () => ({ branchId: 1 }),
      scopeFailure: (error) => error instanceof ScopeError ? Response.json({ error: error.message }, { status: error.status }) : null,
    },
  });
  const post = (body) => POST(new Request("http://localhost/api/payments", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ month: "2026-10", ...body }),
  }));
  return { data, post };
}

test("A note given with the payment is stored and shown in the history", async () => {
  const { data, post } = setup();
  const response = await post({ kind: "add", childId: 1, amount: 1000, method: "cash", paidAt: "2026-09-30", note: "Фактично 01.10" });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(data.payments.at(-1).note, "Фактично 01.10");
  const child = body.rows.find((row) => row.id === 1);
  assert.equal(child.history[0].note, "Фактично 01.10");
});

test("A note can be added to an existing payment and cleared again", async () => {
  const { data, post } = setup();
  await post({ kind: "add", childId: 1, amount: 1000, method: "cash" });
  const id = data.payments.at(-1).id;
  assert.equal(data.payments.at(-1).note, null);
  assert.equal((await post({ kind: "note_set", paymentId: id, note: "Приніс тато" })).status, 200);
  assert.equal(data.payments.at(-1).note, "Приніс тато");
  assert.equal((await post({ kind: "note_set", paymentId: id, note: "" })).status, 200);
  assert.equal(data.payments.at(-1).note, null);
});

test("Another branch's payment note cannot be changed", async () => {
  const { data, post } = setup();
  const response = await post({ kind: "note_set", paymentId: 5, note: "Чуже" });
  assert.notEqual(response.status, 200);
  assert.equal(data.payments.find((row) => row.id === 5).note, null);
});
