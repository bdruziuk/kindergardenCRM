import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm } from "./test-helpers.mjs";

function setup({ closed = null, error = null } = {}) {
  const calls = { close: [], live: [] };
  const liveRows = [{ id: 2, name: "New employee", role: "Teacher", salary: 30000, paidOut: { total: 5000 }, remaining: 25000 }];
  const db = {
    select(selection) {
      // Aggregate SQL is outside this test: its existing result is supplied.
      const rows = Object.hasOwn(selection, "paid") ? [{ id: 2, name: "New employee", role: "Teacher", paid: 5000 }] : [];
      const chain = {
        from: () => chain, innerJoin: () => chain, leftJoin: () => chain,
        where: () => chain, groupBy: () => chain, orderBy: () => chain,
        then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    },
  };
  const { GET } = load("app/api/reports/route.ts", {
    "drizzle-orm": orm, "@/db": { getDb: () => db },
    "@/db/schema": { ...tables, waitlist: { status: "status", branchId: "branch" } },
    "@/lib/api-schemas": schemas,
    "@/lib/month-close": { loadClose: async (...args) => {
      calls.close.push(args);
      if (error) throw error;
      return closed;
    } },
    "@/lib/queries": { staffWithAttendance: async (...args) => {
      calls.live.push(args);
      return { rows: liveRows };
    } },
    "@/lib/scope": { resolveScope: async () => ({ branchId: 7 }), scopeFailure: () => null },
  });
  return { calls, get: async (query = "month=2026-08") => {
    const response = await GET(new Request(`http://localhost/api/reports?${query}`));
    return { status: response.status, body: await response.json() };
  } };
}

test("Closed report preserves historical staff, names, accrued pay, payouts and balance", async () => {
  const { get, calls } = setup({ closed: { snapshot: { staff: { rows: [
    { id: 1, name: "Former employee", role: "Original role", salary: 10000, paidOut: { total: 8000 }, remaining: 2000 },
  ] } } } });
  const result = await get();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.staff, [{ id: 1, name: "Former employee", role: "Original role", accrued: 10000, paid: 8000, remaining: 2000 }]);
  assert.deepEqual(calls.close, [[7, "2026-08"]]);
  assert.deepEqual(calls.live, [], "Closed periods must not recalculate the current timesheet");
});

test("Empty closed staff snapshot must not fall back to newly hired employees", async () => {
  const { get, calls } = setup({ closed: { snapshot: { staff: { rows: [] } } } });
  assert.deepEqual((await get()).body.staff, []);
  assert.deepEqual(calls.live, []);
});

test("Open or reopened month uses current timesheet", async () => {
  const { get, calls } = setup();
  const result = await get();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.staff, [{ id: 2, name: "New employee", role: "Teacher", accrued: 30000, paid: 5000, remaining: 25000 }]);
  assert.deepEqual(calls.live, [[7, "2026-08"]]);
});

test("Yearly report keeps paid-only behavior without monthly recalculation", async () => {
  const { get, calls } = setup();
  const result = await get("year=2026");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.staff, [{ id: 2, name: "New employee", role: "Teacher", accrued: null, paid: 5000, remaining: null }]);
  assert.deepEqual(calls.close, []);
  assert.deepEqual(calls.live, []);
});

test("Failure reading a close does not silently produce current figures", async () => {
  const { get, calls } = setup({ error: new Error("Close lookup unavailable") });
  assert.equal((await get()).status, 500);
  assert.deepEqual(calls.live, []);
});
