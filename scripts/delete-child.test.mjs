import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, fixture, database, ScopeError } from "./test-helpers.mjs";

// Видалення дитини: лише власник, лише в межах своєї філії і лише поки в
// дитини немає оплат — інакше разом із нею зникли б гроші з каси.

function setup({ isOwner = true } = {}) {
  const data = fixture();
  const db = database(data);
  const { POST } = load("app/api/kindergarten/route.ts", {
    "drizzle-orm": orm,
    "@/db": { getDb: () => db },
    "@/db/schema": tables,
    "@/lib/api-schemas": schemas,
    "@/lib/format": { ageLabel: () => "", initialsOf: () => "", moneyLabel: String },
    "@/lib/period": { currentMonth: () => "2026-10", monthStart: (month) => `${month}-01` },
    "@/lib/scope": {
      ScopeError, resolveScope: async () => ({ branchId: 1, isOwner }),
      scopeFailure: (error) => error instanceof ScopeError ? Response.json({ error: error.message }, { status: error.status }) : null,
    },
  });
  const remove = (childId) => POST(new Request("http://localhost/api/kindergarten", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "delete_child", childId }),
  }));
  return { data, remove };
}

test("The owner deletes a child without payments", async () => {
  const { data, remove } = setup();
  const response = await remove(1);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.ok(!data.children.some((child) => child.id === 1));
  assert.ok(!(await response.json()).children.some((child) => child.id === 1));
});

test("A manager may not delete a child", async () => {
  const { data, remove } = setup({ isOwner: false });
  const response = await remove(1);
  assert.equal(response.status, 403);
  assert.ok(data.children.some((child) => child.id === 1));
});

test("A child with payments is kept, and so are the payments", async () => {
  const { data, remove } = setup();
  data.payments.push({ id: 7, childId: 1, billingMonth: "2026-09-01", amount: 1000, method: "cash", paidAt: "2026-09-03", purpose: "tuition" });
  const response = await remove(1);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Вибула/);
  assert.ok(data.children.some((child) => child.id === 1));
  assert.equal(data.payments.length, 1);
});

test("A child from another branch is not found", async () => {
  const { data, remove } = setup();
  const response = await remove(2);
  assert.equal(response.status, 404);
  assert.ok(data.children.some((child) => child.id === 2));
});

test("A queue entry that enrolled the child loses only its link", async () => {
  const { data, remove } = setup();
  data.waitlist.push({ id: 5, branchId: 1, enrolledChildId: 1, childName: "Child 1", parentName: "Parent", parentPhone: "+380", status: "enrolled" });
  const response = await remove(1);
  assert.equal(response.status, 200);
  assert.equal(data.waitlist[0].enrolledChildId, null);
  assert.equal(data.waitlist[0].status, "enrolled");
});
