import assert from "node:assert/strict";
import test from "node:test";
import { load, orm, database } from "./test-helpers.mjs";

// Робота супер-адміністратора від імені власника чи керуючого. Перемикання
// приходить від клієнта через `useSession().update`, тож перевіряємо саме те,
// що підробити його не вийде.

const users = {
  tableName: "users",
  ...Object.fromEntries(["id", "email", "name", "role", "avatar", "kindergartenId"].map((key) => [key, { table: "users", key }])),
};

function setup() {
  const data = {
    users: [
      { id: 1, email: "root@x", name: "Root", role: "superadmin", avatar: null, kindergartenId: null },
      { id: 2, email: "owner@x", name: "Owner", role: "admin", avatar: "data:", kindergartenId: 1 },
      { id: 3, email: "manager@x", name: "Manager", role: "manager", avatar: null, kindergartenId: 1 },
      { id: 4, email: "teacher@x", name: "Teacher", role: "teacher", avatar: null, kindergartenId: 1 },
      { id: 5, email: "orphan@x", name: "Orphan", role: "admin", avatar: null, kindergartenId: null },
    ],
  };
  const { authOptions } = load("lib/auth.ts", {
    bcryptjs: { __esModule: true, default: {} },
    "drizzle-orm": orm,
    "next-auth/providers/credentials": { __esModule: true, default: () => ({}) },
    "@/db": { getDb: () => database(data) },
    "@/db/schema": { users },
  });
  const tokenOf = (id) => {
    const row = data.users.find((user) => user.id === id);
    return { id: String(id), sub: String(id), role: row.role, name: row.name, email: row.email };
  };
  const update = (token, session) =>
    authOptions.callbacks.jwt({ token: { ...token }, trigger: "update", session });
  const sessionOf = (token) =>
    authOptions.callbacks.session({ session: { user: {} }, token });
  return { tokenOf, update, sessionOf };
}

test("The superadmin acts as an owner and comes back", async () => {
  const { tokenOf, update, sessionOf } = setup();
  const acting = await update(tokenOf(1), { impersonate: 2 });
  assert.equal(acting.id, "2");
  assert.equal(acting.role, "admin");
  assert.equal(acting.email, "owner@x");
  assert.equal(acting.hasAvatar, true);
  assert.equal(acting.actorId, "1");
  assert.deepEqual(sessionOf(acting).user.actor, { id: "1", name: "Root" });

  const back = await update(acting, { stopImpersonating: true });
  assert.equal(back.id, "1");
  assert.equal(back.role, "superadmin");
  assert.equal(back.actorId, undefined);
  assert.equal(sessionOf(back).user.actor, undefined);
});

test("The superadmin acts as a manager, and can switch straight to another account", async () => {
  const { tokenOf, update } = setup();
  const manager = await update(tokenOf(1), { impersonate: 3 });
  assert.equal(manager.role, "manager");
  const owner = await update(manager, { impersonate: 2 });
  assert.equal(owner.id, "2");
  assert.equal(owner.actorId, "1", "the real actor is kept, not the manager");
});

test("Nobody but the superadmin can switch accounts", async () => {
  const { tokenOf, update } = setup();
  for (const id of [2, 3, 4]) {
    const token = await update(tokenOf(id), { impersonate: id === 2 ? 3 : 2 });
    assert.equal(token.id, String(id));
    assert.equal(token.actorId, undefined);
  }
});

test("Only owners and managers of a kindergarten can be impersonated", async () => {
  const { tokenOf, update } = setup();
  for (const target of [4, 5, 1, 999, "2; drop"]) {
    const token = await update(tokenOf(1), { impersonate: target });
    assert.equal(token.id, "1", `target ${target}`);
    assert.equal(token.actorId, undefined);
  }
});

test("A forged actor id does not make anyone a superadmin", async () => {
  const { tokenOf, update } = setup();
  // Токен підписаний сервером, але навіть якби в ньому опинився чужий actorId,
  // перевіряється роль того, на кого він вказує.
  const token = await update({ ...tokenOf(3), actorId: "4" }, { impersonate: 2 });
  assert.equal(token.id, "3");
});
