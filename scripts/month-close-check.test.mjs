import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, orm, ScopeError } from "./test-helpers.mjs";

// Перевірка перед закриттям: показує борги батьків, невидану зарплату за
// місяць і касу — рівно з тих знімків, які закриття потім заморозить.
function setup() {
  const period = load("lib/period.ts", { "./api-schemas": schemas });
  const money = load("lib/money.ts", {});
  const { GET } = load("app/api/month-close/route.ts", {
    "drizzle-orm": orm,
    "@/lib/api-schemas": schemas,
    "@/lib/month-close": { loadClose: async () => null },
    "@/lib/money": money,
    "@/lib/period": period,
    "@/lib/scope": {
      ScopeError, resolveScope: async () => ({ branchId: 1 }),
      scopeFailure: () => null,
    },
    "@/lib/snapshots": {
      paymentsSnapshot: async () => ({
        rows: [
          { id: 1, name: "Сплатила", group: "А", balance: 0 },
          { id: 2, name: "Частково", group: "А", balance: 500.5 },
          { id: 3, name: "Не сплатив", group: "Б", balance: 15000 },
        ],
      }),
      financeSnapshot: async () => ({
        salaryRows: [
          { id: 7, name: "Видали все", remaining: 0 },
          { id: 8, name: "Переплатили", remaining: -100 },
          { id: 9, name: "Решта", remaining: 4200 },
        ],
        methods: [
          { method: "cash", opening: 0, income: 755300, expense: 748496.77, balance: 6803.23, closing: 6803.23 },
        ],
      }),
    },
  });
  return (query) => GET(new Request(`http://localhost/api/month-close?${query}`));
}

test("Перевірка перед закриттям: борги, невидана зарплата й каса", async () => {
  const get = setup();
  const body = await (await get("check=1&month=2026-09")).json();
  assert.equal(body.month, "2026-09");
  assert.deepEqual(body.unpaid.rows.map((row) => row.id), [3, 2]);
  assert.equal(body.unpaid.count, 2);
  assert.equal(body.unpaid.total, 15500.5);
  assert.deepEqual(body.salary.rows, [{ id: 9, name: "Решта", remaining: 4200 }]);
  assert.equal(body.salary.total, 4200);
  assert.equal(body.methods[0].closing, 6803.23);
});

test("Без check=1 маршрут, як і раніше, віддає лише стан місяця", async () => {
  const get = setup();
  const body = await (await get("month=2026-09")).json();
  assert.deepEqual(body, { month: "2026-09", closed: false, closedAt: null });
});
