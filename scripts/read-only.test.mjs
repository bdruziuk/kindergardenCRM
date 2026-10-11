import assert from "node:assert/strict";
import test from "node:test";
import { load, orm, database } from "./test-helpers.mjs";

// Режим перегляду: людина бачить усе, але сервер відхиляє будь-яку зміну.
// Прапорець читається з бази на кожен запит, тож діє без повторного входу.

const table = (name, keys) => ({
  tableName: name,
  ...Object.fromEntries(keys.map((key) => [key, { table: name, key }])),
});
const tables = {
  users: table("users", ["id", "role", "branchId", "kindergartenId", "readOnly"]),
  branches: table("branches", ["id", "name", "kindergartenId"]),
};

function setup({ role = "admin", readOnly }) {
  const data = {
    users: [{ id: 1, role, branchId: 1, kindergartenId: 1, readOnly }],
    branches: [{ id: 1, name: "One", kindergartenId: 1 }],
  };
  const scope = load("lib/scope.ts", {
    "drizzle-orm": { ...orm, isNotNull: (column) => (row) => row[column.table]?.[column.key] != null },
    "next-auth": { getServerSession: async () => ({ user: { id: "1" } }) },
    "@/db": { getDb: () => database(data) },
    "@/db/schema": tables,
    "./auth": { authOptions: {} },
  });
  return { scope, data };
}

const status = async (promise) => {
  try {
    await promise;
    return 200;
  } catch (error) {
    if (error instanceof Error && "status" in error) return error.status;
    throw error;
  }
};

test("A read-only user can still look", async () => {
  const { scope } = setup({ readOnly: true });
  const result = await scope.resolveScope(null);
  assert.equal(result.readOnly, true);
  assert.equal(result.branchId, 1);
});

test("A read-only user cannot change anything", async () => {
  const { scope } = setup({ readOnly: true });
  assert.equal(await status(scope.resolveScope(null, { write: true })), 403);
  assert.equal(await status(scope.resolveOwner({ write: true })), 403);
});

test("A read-only manager cannot change anything either", async () => {
  const { scope } = setup({ role: "manager", readOnly: true });
  assert.equal(await status(scope.resolveScope(null, { write: true })), 403);
});

test("Without the flag writing works as before", async () => {
  const { scope } = setup({ readOnly: false });
  assert.equal(await status(scope.resolveScope(null, { write: true })), 200);
  assert.equal(await status(scope.resolveOwner({ write: true })), 200);
});

test("Turning the flag on takes effect on the very next request", async () => {
  const { scope, data } = setup({ readOnly: false });
  assert.equal(await status(scope.resolveScope(null, { write: true })), 200);
  data.users[0].readOnly = true;
  assert.equal(await status(scope.resolveScope(null, { write: true })), 403);
});

test("The refusal says why", () => {
  const { scope } = setup({ readOnly: true });
  assert.throws(() => scope.assertWritable(true), (error) =>
    error.status === 403 && /Режим перегляду/.test(error.message));
  assert.doesNotThrow(() => scope.assertWritable(false));
});
