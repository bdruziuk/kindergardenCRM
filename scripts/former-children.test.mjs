import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, fixture, database, ScopeError } from "./test-helpers.mjs";

// Вибулі з минулих місяців накопичувались у списку дітей і в лічильнику групи.
// Сервер тепер позначає їх `former`, і саме за цією позначкою сторінка ховає
// тих, хто вже не ходить.

const MONTH = "2026-09";

function setup(rows) {
  const data = fixture();
  // Fixture-діти з інших філій тут лише заважають рахувати.
  data.children = rows.map((row, index) => ({
    id: index + 1, branchId: 1, groupId: 1, fullName: `Child ${index + 1}`,
    feeMode: "monthly", dailyRate: 0, customFee: null, ...row,
  }));
  const { POST } = load("app/api/kindergarten/route.ts", {
    "drizzle-orm": orm,
    "@/db": { getDb: () => database(data) },
    "@/db/schema": tables,
    "@/lib/api-schemas": schemas,
    "@/lib/format": { ageLabel: () => "", initialsOf: () => "", moneyLabel: () => "" },
    "@/lib/period": { currentMonth: () => MONTH, monthStart: (month) => `${month}-01` },
    "@/lib/scope": {
      ScopeError, resolveScope: async () => ({ branchId: 1 }),
      scopeFailure: (error) => error instanceof ScopeError ? Response.json({ error: error.message }, { status: error.status }) : null,
    },
  });
  // Будь-яка дія повертає той самий знімок, тож беремо найбезпечнішу.
  return async () => {
    const response = await POST(new Request("http://localhost/api/kindergarten", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "update_group", groupId: 1, name: "Group 1", ageRange: "3–4 роки" }),
    }));
    assert.equal(response.status, 200);
    return response.json();
  };
}

test("A child who left in an earlier month is marked as former", async () => {
  const snapshot = await setup([
    { status: "left", leftAt: "2026-08-20" },
  ])();
  assert.equal(snapshot.children[0].former, true);
});

test("A child who left during the current month still belongs to it", async () => {
  const snapshot = await setup([
    { status: "left", leftAt: "2026-09-01" },
    { status: "left", leftAt: "2026-09-30" },
  ])();
  assert.deepEqual(snapshot.children.map((child) => child.former), [false, false]);
});

test("Leaving without a date counts as long gone rather than as still here", async () => {
  // Інакше кожен статус, поставлений без дати, лишався б у списку назавжди —
  // а це і є та купа, заради якої все затівалось.
  const snapshot = await setup([{ status: "left", leftAt: null }])();
  assert.equal(snapshot.children[0].former, true);
});

test("Active and paused children are never former", async () => {
  const snapshot = await setup([
    { status: "active", leftAt: null },
    { status: "paused", leftAt: null },
    // Дата вибуття без статусу «вибув» нічого не означає: місце за дитиною
    // лишається, поки статус каже, що вона ходить.
    { status: "active", leftAt: "2026-01-15" },
  ])();
  assert.deepEqual(snapshot.children.map((child) => child.former), [false, false, false]);
});

test("Former children are still returned, so the page can list them on demand", async () => {
  const snapshot = await setup([
    { status: "active", leftAt: null },
    { status: "left", leftAt: "2026-08-20" },
  ])();
  assert.equal(snapshot.children.length, 2, "Вибулих ховає сторінка, а не сервер");
});
