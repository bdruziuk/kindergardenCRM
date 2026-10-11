import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, database, ScopeError } from "./test-helpers.mjs";

// Скидання пароля з кабінету: лише супер-адміністратор, лише не собі
// подібному; пароля він не бачить — людині йде посилання, а саме посилання
// повертається йому тільки тоді, коли лист піти не зміг.

const table = (name, keys) => ({
  tableName: name,
  ...Object.fromEntries(keys.map((key) => [key, { table: name, key }])),
});
const adminTables = {
  ...tables,
  users: table("users", ["id", "email", "name", "role", "branchId", "kindergartenId", "avatar", "readOnly"]),
  kindergartens: table("kindergartens", ["id", "name", "createdAt"]),
  invites: table("invites", ["id", "kindergartenId", "email", "role", "expiresAt", "acceptedAt", "createdAt"]),
  branches: table("branches", ["id", "kindergartenId", "name", "address"]),
};

function setup({ viewer = 1, mail = "sent" } = {}) {
  const data = {
    users: [
      { id: 1, email: "root@x", name: "Root", role: "superadmin", kindergartenId: null },
      { id: 2, email: "vika@x", name: "Вікторія", role: "manager", kindergartenId: 1, branchId: 1 },
      { id: 3, email: "root2@x", name: "Root 2", role: "superadmin", kindergartenId: null },
    ],
    kindergartens: [{ id: 1, name: "Garden", createdAt: new Date("2026-09-01") }],
    branches: [{ id: 1, kindergartenId: 1, name: "One" }],
    invites: [], groups: [], children: [], staff: [],
  };
  const sent = [];
  const issued = [];
  const { POST } = load("app/api/admin/route.ts", {
    "drizzle-orm": { ...orm, isNull: (column) => (row) => row[column.table]?.[column.key] == null },
    "next-auth": { getServerSession: async () => ({ user: { id: String(viewer) } }) },
    "@/db": { getDb: () => database(data) },
    "@/db/schema": adminTables,
    "@/lib/api-schemas": schemas,
    "@/lib/auth": { authOptions: {} },
    "@/lib/invites": { publicOrigin: () => "https://app.test" },
    "@/lib/mailer": {
      adminResetLetter: (link) => ({ subject: "s", text: link }),
      sendMail: async (letter) => { sent.push(letter); return mail; },
    },
    "@/lib/password-reset": {
      RESET_TTL_HOURS: 2,
      issueResetToken: async (userId) => { issued.push(userId); return "token-" + userId; },
      resetUrl: (origin, token) => `${origin}/reset?token=${token}`,
    },
    "@/lib/scope": {
      ScopeError,
      scopeFailure: (error) => error instanceof ScopeError ? Response.json({ error: error.message }, { status: error.status }) : null,
    },
  });
  const reset = (userId) => POST(new Request("https://app.test/api/admin", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "password_reset", userId }),
  }));
  return { reset, sent, issued };
}

test("The superadmin sends a reset link; the link itself is not returned", async () => {
  const { reset, sent, issued } = setup();
  const response = await reset(2);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(issued, [2]);
  assert.equal(sent[0].to, "vika@x");
  assert.match(sent[0].text, /reset\?token=token-2/);
  assert.deepEqual(body.passwordReset, { userId: 2, email: "vika@x", delivered: "sent" });
});

test("Without mail the link is handed to the superadmin", async () => {
  const { reset } = setup({ mail: "logged" });
  const body = await (await reset(2)).json();
  assert.equal(body.passwordReset.delivered, "logged");
  assert.equal(body.passwordReset.link, "https://app.test/reset?token=token-2");
});

test("Another superadmin's password cannot be reset this way", async () => {
  const { reset, issued } = setup();
  assert.equal((await reset(3)).status, 404);
  assert.deepEqual(issued, []);
});

test("Only the superadmin can reset passwords", async () => {
  const { reset, issued, sent } = setup({ viewer: 2 });
  assert.equal((await reset(2)).status, 403);
  assert.deepEqual(issued, []);
  assert.deepEqual(sent, []);
});
