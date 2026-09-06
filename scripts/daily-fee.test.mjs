import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, fixture, database, ScopeError } from "./test-helpers.mjs";

// Дитина 1 — поденна за 250 ₴ за день. Поряд, у тій самій філії, дитина 4 на
// місячній платі: без неї не видно, що зміни поденної логіки не зачіпають
// решту, бо діти 2 і 3 з фікстури живуть в інших філіях.
function setup({ days, closedMonth } = {}) {
  const data = fixture();
  for (const child of data.children)
    Object.assign(child, { status: "active", customFee: null });
  Object.assign(data.children[0], { feeMode: "daily", dailyRate: 250 });
  data.children.push({
    id: 4, branchId: 1, groupId: 1, fullName: "Місячна дитина",
    status: "active", customFee: null, feeMode: "monthly", dailyRate: 0,
  });
  if (days !== undefined)
    data.childMonthDays.push({ id: 1, childId: 1, month: "2026-09-01", days });
  if (closedMonth)
    data.monthCloses.push({
      id: 1, branchId: 1, month: `${closedMonth}-01`,
      data: JSON.stringify({ payments: {}, staff: {}, finances: {} }),
      closedAt: new Date(),
    });

  const db = { getDb: () => database(data) };
  const period = load("lib/period.ts", { "./api-schemas": schemas });
  const queries = load("lib/queries.ts", {
    "drizzle-orm": orm, "@/db": db, "@/db/schema": tables,
    "./period": period, "./format": { initialsOf: () => "C" },
  });
  const closes = load("lib/month-close.ts", {
    "drizzle-orm": orm, "@/db": db, "@/db/schema": tables,
    "./period": period, "./scope": { ScopeError },
  });
  const scope = {
    ScopeError,
    resolveScope: async () => ({ branchId: 1 }),
    scopeFailure: (error) => error instanceof ScopeError
      ? Response.json({ error: error.message }, { status: error.status }) : null,
  };
  const post = load("app/api/payments/route.ts", {
    "drizzle-orm": orm, "@/db": db, "@/db/schema": tables,
    "@/lib/api-schemas": schemas, "@/lib/period": period,
    "@/lib/scope": scope, "@/lib/month-close": closes,
    "@/lib/queries": queries,
  }).POST;
  return { data, queries, post };
}

async function request(post, body) {
  const response = await post(new Request("http://localhost/api/payments", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

const child = async (queries, month = "2026-09") =>
  (await queries.childrenWithPayments(1, month)).find((row) => row.id === 1);

test("Нарахування поденній дитині — дні на ставку", async () => {
  const { queries } = setup({ days: 14 });
  const row = await child(queries);
  assert.equal(row.fee, 3500);
  assert.equal(row.days, 14);
  assert.equal(row.dailyRate, 250);
  assert.equal(row.feeMode, "daily");
  assert.equal(row.balance, 3500);
});

test("Без внесених днів не нараховується нічого", async () => {
  const { queries } = setup();
  const row = await child(queries);
  assert.equal(row.fee, 0);
  // null, а не 0: «ще не рахували» — не те саме, що «відходила нуль днів».
  assert.equal(row.days, null);
  assert.equal(row.balance, 0);
});

test("Нуль днів — це нуль, і він відрізняється від невнесених днів", async () => {
  const { queries } = setup({ days: 0 });
  const row = await child(queries);
  assert.equal(row.fee, 0);
  assert.equal(row.days, 0);
});

test("Місячна плата поденній дитині не застосовується", async () => {
  const { data, queries } = setup({ days: 4 });
  // Індивідуальна місячна плата лишилась у картці — вона не має спрацювати.
  data.children[0].customFee = 9999;
  assert.equal((await child(queries)).fee, 1000);
});

test("Місячна дитина поруч не зачеплена, і days у неї порожній", async () => {
  const { queries } = setup({ days: 20 });
  const rows = await queries.childrenWithPayments(1, "2026-09");
  const monthly = rows.find((row) => row.id === 4);
  assert.equal(monthly.feeMode, "monthly");
  assert.equal(monthly.fee, 1000, "плата філії, а не дні");
  assert.equal(monthly.days, null);
  assert.equal(monthly.dailyRate, 0);
  assert.equal((await child(queries)).fee, 5000);
});

test("Дні одного місяця не течуть у сусідній", async () => {
  const { queries } = setup({ days: 10 });
  assert.equal((await child(queries, "2026-09")).fee, 2500);
  const august = await child(queries, "2026-08");
  assert.equal(august.fee, 0);
  assert.equal(august.days, null);
});

test("«Заплановано» рахує поденне нарахування, а не місячну плату", async () => {
  const { queries } = setup({ days: 6 });
  const rows = await queries.childrenWithPayments(1, "2026-09");
  // 6 днів × 250 у поденної + 1000 місячної.
  assert.equal(queries.paymentsSummary(rows).planned, 2500);
});

test("days_set заводить дні, а повторний виклик замінює їх", async () => {
  const { data, post } = setup();
  const first = await request(post, { kind: "days_set", childId: 1, month: "2026-09", days: 8 });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(data.childMonthDays.length, 1);
  assert.equal(data.childMonthDays[0].days, 8);

  await request(post, { kind: "days_set", childId: 1, month: "2026-09", days: 11 });
  assert.equal(data.childMonthDays.length, 1, "рядок один на місяць, а не новий щоразу");
  assert.equal(data.childMonthDays[0].days, 11);
});

test("days_set із null прибирає внесене", async () => {
  const { data, post } = setup({ days: 9 });
  const result = await request(post, { kind: "days_set", childId: 1, month: "2026-09", days: null });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(data.childMonthDays.length, 0);
});

test("Дні місячній дитині не приймаються", async () => {
  const { data, post } = setup();
  data.children[0].feeMode = "monthly";
  const result = await request(post, { kind: "days_set", childId: 1, month: "2026-09", days: 5 });
  assert.equal(result.status, 400);
  assert.equal(data.childMonthDays.length, 0);
});

test("Чужу дитину днями не зачепити", async () => {
  const { data, post } = setup();
  // Дитина 3 живе у філії 3, тобто в іншому садочку.
  const result = await request(post, { kind: "days_set", childId: 3, month: "2026-09", days: 5 });
  assert.equal(result.status, 403);
  assert.equal(data.childMonthDays.length, 0);
});

test("У закритому місяці дні не змінюються", async () => {
  const { data, post } = setup({ closedMonth: "2026-09" });
  const before = structuredClone(data);
  const result = await request(post, { kind: "days_set", childId: 1, month: "2026-09", days: 5 });
  assert.equal(result.status, 409);
  assert.deepEqual(data, before);
});

test("Схема відкидає неможливу кількість днів", () => {
  const bad = schemas.paymentRequest.safeParse({ kind: "days_set", childId: 1, month: "2026-09", days: 32 });
  assert.equal(bad.success, false);
  const negative = schemas.paymentRequest.safeParse({ kind: "days_set", childId: 1, month: "2026-09", days: -1 });
  assert.equal(negative.success, false);
  const ok = schemas.paymentRequest.safeParse({ kind: "days_set", childId: 1, month: "2026-09", days: 31 });
  assert.equal(ok.success, true);
});

test("Ставка не переживає повернення на місячну оплату", () => {
  const monthly = schemas.childInput.parse({
    fullName: "Дитина", groupName: "Group 1", fee: 1000,
    feeMode: "monthly", dailyRate: 250,
  });
  // Схема ставку пропускає — обнуляє її маршрут, щоб забута цифра не
  // нарахувала одного дня те, про що вже ніхто не пам'ятає.
  assert.equal(monthly.dailyRate, 250);
  assert.equal(monthly.feeMode, "monthly");
  const fallback = schemas.childInput.parse({
    fullName: "Дитина", groupName: "Group 1", fee: 1000,
  });
  assert.equal(fallback.feeMode, "monthly");
  assert.equal(fallback.dailyRate, 0);
});
