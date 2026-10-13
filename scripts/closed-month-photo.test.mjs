import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, fixture, database, ScopeError } from "./test-helpers.mjs";

// Закритий місяць віддається зі знімка, але фото — ні: воно не про гроші,
// тож береться поточне, навіть якщо знімок зробили до того, як фото з'явилося.

function setup() {
  const data = fixture();
  data.staff[0].photo = "iVBORw0KGgo=";
  const withPhoto = { ...tables, staff: { ...tables.staff, photo: { table: "staff", key: "photo" } } };
  const frozen = {
    rows: [
      { id: 1, name: "Staff 1", salary: 1234, hasPhoto: false },
      { id: 4, name: "Left later", salary: 50 },
    ],
    summary: { salaryTotal: 1284 },
  };
  const { GET } = load("app/api/staff/route.ts", {
    "drizzle-orm": { ...orm, isNotNull: (column) => (row) => row[column.table]?.[column.key] != null },
    "@/db": { getDb: () => database(data) },
    "@/db/schema": withPhoto,
    "@/lib/api-schemas": schemas,
    "@/lib/period": { currentMonth: () => "2026-10", monthStart: (month) => `${month}-01` },
    "@/lib/month-close": {
      assertMonthOpen: async () => {},
      loadClose: async () => ({ closedAt: "2026-10-01T10:00:00.000Z", snapshot: { staff: frozen } }),
    },
    "@/lib/payouts": {},
    "@/lib/snapshots": { staffSnapshot: async () => ({ rows: [] }) },
    "@/lib/scope": {
      ScopeError, resolveScope: async () => ({ branchId: 1 }),
      scopeFailure: (error) => error instanceof ScopeError ? Response.json({ error: error.message }, { status: error.status }) : null,
    },
  });
  return { GET };
}

test("A closed month shows today's photos but keeps its frozen figures", async () => {
  const { GET } = setup();
  const body = await (await GET(new Request("http://localhost/api/staff?month=2026-09"))).json();
  assert.equal(body.closed, true);
  assert.equal(body.rows[0].hasPhoto, true, "photo added after closing is shown");
  assert.equal(body.rows[0].salary, 1234, "salary stays as frozen");
  assert.equal(body.rows[1].hasPhoto, false);
  assert.equal(body.summary.salaryTotal, 1284);
});
