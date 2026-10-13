import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, cashMocks } from "./test-helpers.mjs";

function setup({ closed = null, error = null } = {}) {
  const calls = { close: [], live: [] };
  const liveRows = [{ id: 2, name: "New employee", role: "Teacher", salary: 30000, paidOut: { total: 5000 }, remaining: 25000 }];
  const db = {
    select(selection) {
      // Aggregate SQL is outside this test: its existing result is supplied.
      const rows = Object.hasOwn(selection, "paid")
        ? [{ id: 2, name: "New employee", role: "Teacher", paid: 5000 }]
        : Object.hasOwn(selection, "current")
          ? [{ inPeriod: 104, joined: 3, left: 2, paused: 1, current: 97, atEnd: 99 }]
          : [];
      const chain = {
        from: () => chain, innerJoin: () => chain, leftJoin: () => chain,
        where: () => chain, groupBy: () => chain, orderBy: () => chain,
        then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    },
  };
  const { GET } = load("app/api/reports/route.ts", {
    ...cashMocks(),
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

// Велика цифра «дітей»: зараз — для періоду, що триває; на закриття — для
// закритого місяця; на кінець — для минулого незакритого. Рух за період
// лишається поруч.
const thisMonth = new Date().toISOString().slice(0, 7);

test("A closed month shows the children count frozen at closing", async () => {
  const { get } = setup({ closed: {
    closedAt: "2026-10-13T14:55:00.000Z",
    snapshot: { staff: { rows: [] }, dashboard: { children: { active: 97, inGarden: 98 } } },
  } });
  const { children } = (await get("month=2026-09")).body;
  assert.equal(children.headcount, 98);
  assert.equal(children.headcountAsOf, "closed");
  assert.equal(children.headcountDate, "2026-10-13");
  assert.equal(children.inPeriod, 104);
  assert.equal(children.joined, 3);
});

test("An older snapshot without the in-garden count falls back to active children", async () => {
  const { get } = setup({ closed: {
    closedAt: "2026-10-11T18:58:00.000Z",
    snapshot: { staff: { rows: [] }, dashboard: { children: { active: 97 } } },
  } });
  assert.equal((await get("month=2026-08")).body.children.headcount, 97);
});

test("A month closed before the overview was frozen counts by dates at its end", async () => {
  const { get } = setup({ closed: { closedAt: "2026-08-30T07:33:00.000Z", snapshot: { staff: { rows: [] } } } });
  const { children } = (await get("month=2026-07")).body;
  assert.equal(children.headcount, 99);
  assert.equal(children.headcountAsOf, "periodEnd");
  assert.equal(children.headcountDate, "2026-07-31");
});

test("The month in progress shows today's count", async () => {
  const { get } = setup();
  const { children } = (await get(`month=${thisMonth}`)).body;
  assert.equal(children.headcount, 97);
  assert.equal(children.headcountAsOf, "today");
});

test("A past open month shows the count at its end", async () => {
  const { get } = setup();
  const { children } = (await get("month=2026-08")).body;
  assert.equal(children.headcount, 99);
  assert.equal(children.headcountAsOf, "periodEnd");
  assert.equal(children.headcountDate, "2026-08-31");
});
