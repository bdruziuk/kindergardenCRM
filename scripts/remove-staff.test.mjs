import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, fixture, database, ScopeError } from "./test-helpers.mjs";

// Видалення працівника: лише власник і лише в межах своєї філії. Без жодного
// запису працівник зникає зовсім; із записами — стає звільненим, щоб минулі
// місяці, каса й борг по зарплаті лишились як були.

function setup({ isOwner = true } = {}) {
  const data = fixture();
  // Працівник 1 у фікстурі вже має відмітку й заняття; 4 — заведений помилково.
  data.staff.push({ id: 4, branchId: 1, fullName: "Mistake", active: true });
  data.groupStaff.push({ groupId: 1, staffId: 1 }, { groupId: 1, staffId: 4 });
  const { POST } = load("app/api/staff/route.ts", {
    "drizzle-orm": orm,
    "@/db": { getDb: () => database(data) },
    "@/db/schema": tables,
    "@/lib/api-schemas": schemas,
    "@/lib/period": { currentMonth: () => "2026-10" },
    "@/lib/month-close": { assertMonthOpen: async () => {} },
    "@/lib/payouts": {},
    "@/lib/snapshots": { staffSnapshot: async () => ({ rows: [] }) },
    "@/lib/scope": {
      ScopeError, resolveScope: async () => ({ branchId: 1, isOwner }),
      scopeFailure: (error) => error instanceof ScopeError ? Response.json({ error: error.message }, { status: error.status }) : null,
    },
  });
  const remove = (staffId) => POST(new Request("http://localhost/api/staff", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "remove_staff", staffId, month: "2026-10" }),
  }));
  const person = (id) => data.staff.find((row) => row.id === id);
  return { data, remove, person };
}

test("A record with no timesheet, lessons or payouts is deleted outright", async () => {
  const { remove, person } = setup();
  const response = await remove(4);
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(person(4), undefined);
});

test("Someone who worked is dismissed, not deleted, and their history stays", async () => {
  const { data, remove, person } = setup();
  data.salaryPayments.push({ id: 9, staffId: 1, month: "2026-09-01", amount: 5000, kind: "salary", method: "cash", paidAt: "2026-10-01" });
  const response = await remove(1);
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(person(1).active, false);
  assert.equal(data.staffAttendance.filter((row) => row.staffId === 1).length, 1);
  assert.equal(data.lessons.filter((row) => row.staffId === 1).length, 1);
  assert.equal(data.salaryPayments.length, 1, "payouts stay in the cash book");
  assert.ok(!data.groupStaff.some((row) => row.staffId === 1), "a dismissed person leaves their groups");
  assert.ok(data.groupStaff.some((row) => row.staffId === 4), "nobody else is unassigned");
});

test("Payouts alone are enough to keep the record", async () => {
  const { data, remove, person } = setup();
  data.salaryPayments.push({ id: 9, staffId: 4, month: "2026-09-01", amount: 1000, kind: "advance", method: "cash", paidAt: "2026-09-15" });
  assert.equal((await remove(4)).status, 200);
  assert.equal(person(4).active, false);
});

test("A manager may not remove staff", async () => {
  const { remove, person } = setup({ isOwner: false });
  assert.equal((await remove(4)).status, 403);
  assert.equal(person(4).active, true);
});

test("Staff of another branch are not found", async () => {
  const { remove, person } = setup();
  assert.equal((await remove(2)).status, 404);
  assert.equal(person(2).active, true);
});
