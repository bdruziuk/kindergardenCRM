import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import { load, schemas, orm, database, ScopeError } from "./test-helpers.mjs";

// Зміна пароля в налаштуваннях без листа: старий пароль, новий і повтор.
// Повтор звіряє сторінка; сервер перевіряє старий пароль і довжину нового.

const table = (name, keys) => ({
  tableName: name,
  ...Object.fromEntries(keys.map((key) => [key, { table: name, key }])),
});
const tables = {
  users: table("users", ["id", "role", "branchId", "kindergartenId", "name", "email", "theme", "avatar", "readOnly", "passwordHash"]),
  branches: table("branches", ["id", "kindergartenId", "name", "address", "theme", "themeByOwner", "monthlyFee"]),
  kindergartens: table("kindergartens", ["id", "name"]),
  jobTitles: table("jobTitles", ["id", "kindergartenId", "branchId", "name", "salaryType", "rate", "lessonRate", "vacationQuota", "dayOffQuota", "addedByOwner"]),
  invites: table("invites", ["id", "kindergartenId", "email", "role", "branchId", "expiresAt", "acceptedAt", "createdAt"]),
  passwordResets: table("passwordResets", ["id", "userId", "tokenHash", "usedAt", "expiresAt"]),
};

function setup({ readOnly = false } = {}) {
  const data = {
    users: [
      { id: 2, role: "manager", branchId: 1, kindergartenId: 1, name: "Manager", email: "m@x", readOnly, passwordHash: bcrypt.hashSync("old-secret", 4) },
      { id: 3, role: "teacher", branchId: 1, kindergartenId: 1, name: "Teacher", email: "t@x", passwordHash: bcrypt.hashSync("other-pass", 4) },
    ],
    branches: [{ id: 1, kindergartenId: 1, name: "One", address: null, theme: null, themeByOwner: false, monthlyFee: 12000 }],
    kindergartens: [{ id: 1, name: "Garden" }],
    jobTitles: [],
    invites: [],
    passwordResets: [
      { id: 1, userId: 2, tokenHash: "a", usedAt: null, expiresAt: new Date(Date.now() + 3600e3) },
      { id: 2, userId: 3, tokenHash: "b", usedAt: null, expiresAt: new Date(Date.now() + 3600e3) },
    ],
  };
  const db = database(data);
  const { POST } = load("app/api/settings/route.ts", {
    bcryptjs: { default: bcrypt },
    "drizzle-orm": { ...orm, isNull: (column) => (row) => row[column.table]?.[column.key] == null },
    "next-auth": { getServerSession: async () => ({ user: { id: "2" } }) },
    "@/db": { getDb: () => db },
    "@/db/schema": tables,
    "@/lib/api-schemas": schemas,
    "@/lib/auth": { authOptions: {} },
    "@/lib/scope": {
      ScopeError,
      scopeFailure: (error) => error instanceof ScopeError ? Response.json({ error: error.message }, { status: error.status }) : null,
      assertWritable: (readOnly) => { if (readOnly) throw new ScopeError("Режим перегляду", 403); },
    },
    "@/lib/invites": {},
    "@/lib/mailer": {},
    "@/lib/password-reset": {},
    "@/lib/theme": { DEFAULT_THEME: "green" },
  });
  const change = async (currentPassword, newPassword) => {
    const response = await POST(new Request("http://localhost/api/settings", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "password_change", currentPassword, newPassword }),
    }));
    return { status: response.status, body: await response.json() };
  };
  const hashOf = (id) => data.users.find((user) => user.id === id).passwordHash;
  return { data, change, hashOf };
}

test("Пароль змінюється, якщо старий правильний", async () => {
  const { data, change, hashOf } = setup();
  const result = await change("old-secret", "new-secret-1");
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(bcrypt.compareSync("new-secret-1", hashOf(2)));
  // Надіслані раніше посилання на зміну пароля більше не діють, чужі — не зачеплені.
  assert.deepEqual(data.passwordResets.map((row) => row.userId), [3]);
  assert.ok(bcrypt.compareSync("other-pass", hashOf(3)));
});

test("Невірний старий пароль — відмова, пароль той самий", async () => {
  const { change, hashOf } = setup();
  const before = hashOf(2);
  const result = await change("wrong", "new-secret-1");
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "Старий пароль невірний");
  assert.equal(hashOf(2), before);
});

test("Новий пароль коротший за 8 символів або такий самий — відмова", async () => {
  const { change, hashOf } = setup();
  const before = hashOf(2);
  assert.equal((await change("old-secret", "short")).status, 400);
  const same = await change("old-secret", "old-secret");
  assert.equal(same.status, 400);
  assert.match(same.body.error, /відрізнятися/);
  assert.equal(hashOf(2), before);
});

test("У режимі перегляду власний пароль змінити можна", async () => {
  const { change, hashOf } = setup({ readOnly: true });
  assert.equal((await change("old-secret", "new-secret-1")).status, 200);
  assert.ok(bcrypt.compareSync("new-secret-1", hashOf(2)));
});
