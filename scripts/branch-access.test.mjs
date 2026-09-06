import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

// Run real route handlers and Zod schemas against a small in-memory query
// adapter. No credentials, server, or application database are used.
const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
function load(relative, mocks = {}) {
  const source = ts.transpileModule(readFileSync(new URL(relative, root), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", source)(
    (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    loaded, loaded.exports,
  );
  return loaded.exports;
}
const schemas = load("lib/api-schemas.ts");
const columns = {
  branches: ["id", "kindergartenId", "monthlyFee"],
  children: ["id", "branchId", "groupId", "fullName", "customFee", "status", "birthDate", "enrolledAt", "leftAt"],
  groups: ["id", "branchId", "name", "ageRange", "icon", "color"],
  relatives: ["id", "childId", "fullName", "relation", "phone"],
  staff: ["id", "branchId", "fullName", "role", "active"],
  lessons: ["id", "staffId", "workDate", "note"],
  staffAttendance: ["id", "staffId", "workDate", "kind"],
  groupStaff: ["groupId", "staffId"],
};
const tables = Object.fromEntries(Object.entries(columns).map(([name, keys]) => [name, {
  tableName: name,
  ...Object.fromEntries(keys.map((key) => [key, { table: name, key }])),
}]));
const value = (column, row) => column?.table ? row[column.table]?.[column.key] : column;
const orm = {
  eq: (a, b) => (row) => value(a, row) === value(b, row),
  and: (...conditions) => (row) => conditions.every((condition) => condition(row)),
  inArray: (column, values) => (row) => values.includes(value(column, row)),
  asc: () => null,
  sql: (strings, ...args) => strings.join("").includes(" and ")
    ? (row) => value(args[0], row) === args[1] && value(args[2], row) === args[3]
    : 0,
};
function fixture() {
  const data = Object.fromEntries(Object.keys(tables).map((name) => [name, []]));
  for (const branchId of [1, 2, 3]) {
    data.branches.push({ id: branchId, kindergartenId: branchId === 3 ? 2 : 1, monthlyFee: 1000 });
    data.groups.push({ id: branchId, branchId, name: `Group ${branchId}` });
    data.children.push({ id: branchId, branchId, groupId: branchId, fullName: `Child ${branchId}` });
    data.relatives.push({ id: branchId, childId: branchId, fullName: `Parent ${branchId}` });
    data.staff.push({ id: branchId, branchId, fullName: `Staff ${branchId}`, active: true });
    data.lessons.push({ id: branchId, staffId: branchId, workDate: "2026-09-01", note: "Original" });
    data.staffAttendance.push({ id: branchId, staffId: branchId, workDate: "2026-09-01", kind: "worked" });
  }
  return data;
}
function database(data) {
  function query(kind, table, selection) {
    let condition = () => true, fields, conflict, joins = [];
    const chain = {
      from: (next) => { table = next; return chain; },
      where: (next) => { condition = next; return chain; },
      set: (next) => { fields = next; return chain; },
      values: (next) => { fields = next; return chain; },
      returning: (next) => { selection = next; return chain; },
      orderBy: () => chain,
      groupBy: () => chain,
      onConflictDoUpdate: (next) => { conflict = next; return chain; },
      innerJoin: (next, on) => { joins.push({ next, on, left: false }); return chain; },
      leftJoin: (next, on) => { joins.push({ next, on, left: true }); return chain; },
      then(resolve, reject) {
        try {
          let rows = data[table.tableName].map((row) => ({ [table.tableName]: row }));
          for (const { next, on, left } of joins) {
            rows = rows.flatMap((row) => {
              const matches = data[next.tableName].map((other) => ({ ...row, [next.tableName]: other })).filter(on);
              return matches.length ? matches : left ? [row] : [];
            });
          }
          rows = rows.filter(condition);
          if (kind === "update") rows.forEach((row) => Object.assign(row[table.tableName], fields));
          if (kind === "delete") data[table.tableName] = data[table.tableName].filter((row) => !rows.some((item) => item[table.tableName] === row));
          if (kind === "insert") {
            rows = (Array.isArray(fields) ? fields : [fields]).map((item) => {
              const existing = conflict && data[table.tableName].find((row) => conflict.target.every((column) => row[column.key] === item[column.key]));
              const row = existing || { id: 100, ...item };
              if (existing) Object.assign(existing, conflict.set);
              else data[table.tableName].push(row);
              return { [table.tableName]: row };
            });
          }
          return Promise.resolve(rows.map((row) => selection
            ? Object.fromEntries(Object.entries(selection).map(([key, column]) => [key, value(column, row)]))
            : row[table.tableName])).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    };
    return chain;
  }
  const db = {
    select: (selection) => query("select", null, selection),
    update: (table) => query("update", table),
    delete: (table) => query("delete", table),
    insert: (table) => query("insert", table),
    transaction: async (callback) => {
      const before = structuredClone(data);
      try { return await callback(db); }
      catch (error) { Object.assign(data, before); throw error; }
    },
  };
  return db;
}
class ScopeError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
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
