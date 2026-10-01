import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, orm, database, ScopeError } from "./test-helpers.mjs";

// Базова плата філії: власник міняє будь-яку у своєму садочку, керуючий —
// лише свою, вихователь — жодну.

const table = (name, keys) => ({
  tableName: name,
  ...Object.fromEntries(keys.map((key) => [key, { table: name, key }])),
});
const tables = {
  users: table("users", ["id", "role", "branchId", "kindergartenId", "name", "email", "theme", "avatar"]),
  branches: table("branches", ["id", "kindergartenId", "name", "address", "theme", "themeByOwner", "monthlyFee"]),
  kindergartens: table("kindergartens", ["id", "name"]),
  jobTitles: table("jobTitles", ["id", "kindergartenId", "branchId", "name", "salaryType", "rate", "lessonRate", "vacationQuota", "dayOffQuota", "addedByOwner"]),
  invites: table("invites", ["id", "kindergartenId", "email", "role", "branchId", "expiresAt", "acceptedAt", "createdAt"]),
};

function setup(userId) {
  const data = {
    users: [
      { id: 1, role: "admin", branchId: null, kindergartenId: 1, name: "Owner", email: "o@x" },
      { id: 2, role: "manager", branchId: 1, kindergartenId: 1, name: "Manager", email: "m@x" },
      { id: 3, role: "teacher", branchId: 1, kindergartenId: 1, name: "Teacher", email: "t@x" },
    ],
    branches: [
      { id: 1, kindergartenId: 1, name: "One", address: null, theme: null, themeByOwner: false, monthlyFee: 12000 },
      { id: 2, kindergartenId: 1, name: "Two", address: null, theme: null, themeByOwner: false, monthlyFee: 12000 },
      { id: 3, kindergartenId: 2, name: "Foreign", address: null, theme: null, themeByOwner: false, monthlyFee: 12000 },
    ],
    kindergartens: [{ id: 1, name: "Garden" }, { id: 2, name: "Other" }],
    jobTitles: [],
    invites: [],
  };
  const db = database(data);
  const { POST } = load("app/api/settings/route.ts", {
    "drizzle-orm": { ...orm, isNull: (column) => (row) => row[column.table]?.[column.key] == null },
    "next-auth": { getServerSession: async () => ({ user: { id: String(userId) } }) },
    "@/db": { getDb: () => db },
    "@/db/schema": tables,
    "@/lib/api-schemas": schemas,
    "@/lib/auth": { authOptions: {} },
    "@/lib/scope": {
      ScopeError,
      scopeFailure: (error) => error instanceof ScopeError ? Response.json({ error: error.message }, { status: error.status }) : null,
    },
    "@/lib/invites": {},
    "@/lib/mailer": {},
    "@/lib/password-reset": {},
    "@/lib/theme": { DEFAULT_THEME: "green" },
  });
  const setFee = (branchId, monthlyFee) => POST(new Request("http://localhost/api/settings", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "branch_fee", branchId, monthlyFee }),
  }));
  const fee = (id) => data.branches.find((branch) => branch.id === id).monthlyFee;
  return { setFee, fee };
}

test("A manager changes the base fee of their own branch", async () => {
  const { setFee, fee } = setup(2);
  const response = await setFee(1, 13500);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(fee(1), 13500);
  const branch = (await response.json()).branches.find((item) => item.id === 1);
  assert.equal(branch.monthlyFee, 13500);
  assert.equal(branch.canEditFee, true);
});

test("A manager may not change another branch's fee", async () => {
  const { setFee, fee } = setup(2);
  assert.equal((await setFee(2, 1)).status, 403);
  assert.equal(fee(2), 12000);
});

test("A teacher may not change the fee", async () => {
  const { setFee, fee } = setup(3);
  assert.equal((await setFee(1, 1)).status, 403);
  assert.equal(fee(1), 12000);
});

test("The owner changes any branch of their kindergarten, but not a foreign one", async () => {
  const { setFee, fee } = setup(1);
  assert.equal((await setFee(2, 14000)).status, 200);
  assert.equal(fee(2), 14000);
  assert.equal((await setFee(3, 1)).status, 403);
  assert.equal(fee(3), 12000);
});

test("A negative fee is refused", async () => {
  const { setFee, fee } = setup(2);
  assert.equal((await setFee(1, -5)).status, 400);
  assert.equal(fee(1), 12000);
});
