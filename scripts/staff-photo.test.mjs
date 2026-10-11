import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, fixture, database, ScopeError } from "./test-helpers.mjs";

// Фото працівника: ставить і прибирає власник або керуючий, лише своїм;
// закритий місяць цьому не заважає, бо фото не належить місяцю.

const png = "data:image/png;base64,iVBORw0KGgo=";

function setup({ canManageBranch = true, closed = false } = {}) {
  const data = fixture();
  const photoTables = {
    ...tables,
    staff: { ...tables.staff, photo: { table: "staff", key: "photo" }, photoMime: { table: "staff", key: "photoMime" } },
  };
  const { POST } = load("app/api/staff/route.ts", {
    "drizzle-orm": orm,
    "@/db": { getDb: () => database(data) },
    "@/db/schema": photoTables,
    "@/lib/api-schemas": schemas,
    "@/lib/period": { currentMonth: () => "2026-10", monthStart: (month) => `${month}-01` },
    "@/lib/month-close": {
      assertMonthOpen: async () => { if (closed) throw new ScopeError("Місяць закрито", 409); },
    },
    "@/lib/payouts": {},
    "@/lib/snapshots": { staffSnapshot: async () => ({ rows: [] }) },
    "@/lib/scope": {
      ScopeError, resolveScope: async () => ({ branchId: 1, canManageBranch }),
      scopeFailure: (error) => error instanceof ScopeError ? Response.json({ error: error.message }, { status: error.status }) : null,
    },
  });
  const post = (body) => POST(new Request("http://localhost/api/staff", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ month: "2026-09", ...body }),
  }));
  const person = (id) => data.staff.find((row) => row.id === id);
  return { post, person };
}

test("A manager sets and clears a staff member's photo", async () => {
  const { post, person } = setup();
  const set = await post({ kind: "photo_set", staffId: 1, dataUrl: png });
  assert.equal(set.status, 200, JSON.stringify(await set.json()));
  assert.equal(person(1).photo, "iVBORw0KGgo=");
  assert.equal(person(1).photoMime, "image/png");
  assert.equal((await post({ kind: "photo_clear", staffId: 1 })).status, 200);
  assert.equal(person(1).photo, null);
  assert.equal(person(1).photoMime, null);
});

test("A closed month does not block the photo", async () => {
  const { post, person } = setup({ closed: true });
  assert.equal((await post({ kind: "photo_set", staffId: 1, dataUrl: png })).status, 200);
  assert.equal(person(1).photoMime, "image/png");
});

test("A teacher cannot change a photo", async () => {
  const { post, person } = setup({ canManageBranch: false });
  assert.equal((await post({ kind: "photo_set", staffId: 1, dataUrl: png })).status, 403);
  assert.equal(person(1).photo, undefined);
});

test("Another branch's staff are not found", async () => {
  const { post, person } = setup();
  assert.equal((await post({ kind: "photo_set", staffId: 2, dataUrl: png })).status, 404);
  assert.equal(person(2).photo, undefined);
});

test("Only images are accepted", async () => {
  const { post } = setup();
  const response = await post({ kind: "photo_set", staffId: 1, dataUrl: "data:text/html;base64,PGI+" });
  assert.equal(response.status, 400);
});
