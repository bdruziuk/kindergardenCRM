import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, fixture, database, ScopeError } from "./test-helpers.mjs";

const period = load("lib/period.ts", { "./api-schemas": schemas });

/**
 * Початковий залишок — цифра, з якої рахується вся каса філії, тож її вносить
 * лише власник, і лише у відкритий місяць.
 */
function setup({ isOwner = true, closedMonth = null } = {}) {
  const data = fixture();
  if (closedMonth)
    data.monthCloses.push({
      id: 1,
      branchId: 1,
      month: `${closedMonth}-01`,
      data: JSON.stringify({ payments: {}, staff: {}, finances: {} }),
      closedAt: new Date(),
    });
  const db = { getDb: () => database(data) };
  const scope = {
    ScopeError,
    resolveScope: async () => ({ branchId: 1, isOwner, userId: 7 }),
    scopeFailure: (error) =>
      error instanceof ScopeError
        ? Response.json({ error: error.message }, { status: error.status })
        : null,
  };
  const closes = load("lib/month-close.ts", {
    "drizzle-orm": orm, "@/db": db, "@/db/schema": tables,
    "./period": period, "./scope": scope,
  });
  const { POST } = load("app/api/finances/route.ts", {
    "drizzle-orm": orm, "@/db": db, "@/db/schema": tables,
    "@/lib/api-schemas": schemas, "@/lib/period": period, "@/lib/scope": scope,
    "@/lib/month-close": closes, "@/lib/payouts": {},
    "@/lib/snapshots": { financeSnapshot: async () => ({}) },
  });
  return { data, POST };
}

const send = async (POST, body) => {
  const response = await POST(
    new Request("http://localhost/api/finances", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
};

const opening = {
  kind: "opening_set",
  method: "cash",
  amount: 4000,
  asOf: "2026-09-01",
  month: "2026-09",
};

test("Власник вносить початковий залишок", async () => {
  const { data, POST } = setup();
  const result = await send(POST, opening);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(data.cashOpeningBalances.length, 1);
  assert.equal(data.cashOpeningBalances[0].amount, 4000);
  assert.equal(data.cashOpeningBalances[0].branchId, 1);
  assert.equal(data.cashOpeningBalances[0].createdBy, 7);
});

test("Керуючий початковий залишок не вносить", async () => {
  const { data, POST } = setup({ isOwner: false });
  const result = await send(POST, opening);
  assert.equal(result.status, 403);
  assert.equal(data.cashOpeningBalances.length, 0);
});

test("У закритий місяць залишок не вносять", async () => {
  const { data, POST } = setup({ closedMonth: "2026-09" });
  const result = await send(POST, opening);
  assert.equal(result.status, 409);
  assert.equal(data.cashOpeningBalances.length, 0);
});

test("Філія береться з доступу, а не з тіла запиту", async () => {
  const { data, POST } = setup();
  const result = await send(POST, { ...opening, branchId: 99 });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(data.cashOpeningBalances[0].branchId, 1);
});

test("Відʼємний залишок і невідомий вид грошей відхиляються", () => {
  assert.equal(schemas.transactionRequest.safeParse({ ...opening, amount: -1 }).success, false);
  assert.equal(schemas.transactionRequest.safeParse({ ...opening, method: "btc" }).success, false);
  // Нуль — теж відповідь: «на цю дату готівки не було».
  assert.equal(schemas.transactionRequest.safeParse({ ...opening, amount: 0 }).success, true);
});

test("Місяць роботи виплати приходить окремим полем і не плутається зі сторінкою", () => {
  const parsed = schemas.staffRequest.parse({
    kind: "payout_add",
    staffId: 1,
    payoutKind: "salary",
    amount: 100,
    method: "cash",
    paidAt: "2026-10-05",
    month: "2026-10",
    payrollMonth: "2026-09",
  });
  assert.equal(parsed.payrollMonth, "2026-09");
  assert.equal(parsed.month, "2026-10");
  // Місяць роботи не обовʼязковий: без нього береться місяць сторінки.
  assert.equal(
    schemas.staffRequest.safeParse({
      kind: "payout_add", staffId: 1, payoutKind: "salary",
      amount: 100, method: "cash", paidAt: "2026-10-05",
    }).success,
    true,
  );
  // Підставити сміття замість місяця не вийде.
  assert.equal(
    schemas.staffRequest.safeParse({
      kind: "payout_add", staffId: 1, payoutKind: "salary", amount: 100,
      method: "cash", paidAt: "2026-10-05", payrollMonth: "2026-13",
    }).success,
    false,
  );
});
