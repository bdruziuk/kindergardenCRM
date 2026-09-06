import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, fixture, database, ScopeError } from "./test-helpers.mjs";

const actions = [
  ["kindergarten", { kind: "update_group", name: "Changed" }, "groupId"],
  ["kindergarten", { kind: "update_child", child: { fullName: "Changed", groupName: "Group 1", fee: 1000, relatives: [{ name: "New parent" }] } }, "childId"],
  ["staff", { kind: "update_staff", name: "Changed", monthlyRate: 9000 }, "staffId"],
  ["staff", { kind: "attendance", state: "absent", date: "2026-09-01" }, "staffId"],
  ["staff", { kind: "attendance", state: "unmarked", date: "2026-09-01" }, "staffId"],
  ["staff", { kind: "attendance", state: "worked", date: "2026-09-02" }, "staffId"],
  ["staff", { kind: "lesson_add", note: "New", date: "2026-09-02" }, "staffId"],
  ["staff", { kind: "lesson_note", note: "Changed" }, "lessonId"],
  ["staff", { kind: "lesson_remove" }, "lessonId"],
];
for (const [route, action, idField] of actions) {
  for (const [id, label] of [[1, "own branch"], [2, "sibling branch"], [3, "other kindergarten"], [999, "missing record"]]) {
    test(`${action.kind} ${action.state ?? action.date ?? ""}: ${label}`, async () => {
      const data = fixture();
      const before = structuredClone(data);
      const { POST } = load(`app/api/${route}/route.ts`, {
        "drizzle-orm": orm,
        "@/db": { getDb: () => database(data) },
        "@/db/schema": tables,
        "@/lib/api-schemas": schemas,
        "@/lib/period": { FALLBACK_MONTH: "2026-09" },
        "@/lib/month-close": { assertMonthOpen: async () => {} },
        "@/lib/payouts": {},
        "@/lib/snapshots": { staffSnapshot: async () => ({}) },
        "@/lib/format": { ageLabel: () => "", initialsOf: () => "", moneyLabel: () => "" },
        "@/lib/scope": {
          ScopeError, resolveScope: async () => ({ branchId: 1 }),
          scopeFailure: (error) => error instanceof ScopeError ? Response.json({ error: error.message }, { status: error.status }) : null,
        },
      });
      const response = await POST(new Request(`http://localhost/api/${route}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...action, [idField]: id, month: "2026-09" }),
      }));
      assert.equal(response.status, id === 1 ? 200 : 404, JSON.stringify(await response.json()));
      if (id !== 1) assert.deepEqual(data, before, "Rejected request must leave every table unchanged");
      else {
        assert.notDeepEqual(data, before, "Authorized operation must still modify data");
        for (const name of ["children", "groups", "relatives", "staff", "lessons", "staffAttendance"]) {
          assert.deepEqual(data[name].filter((row) => row.id === 2 || row.id === 3), before[name].filter((row) => row.id === 2 || row.id === 3));
        }
      }
    });
  }
}
