import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, orm, tables, cashMocks } from "./test-helpers.mjs";

// Структура витрат: аванс і зарплата — окремими категоріями, обидві за датою
// видачі, і разом дають ту саму суму, що й «видано зарплат».

const period = load("lib/period.ts", { "./api-schemas": schemas });

function snapshotWith(salary) {
  const { financeSnapshot } = load("lib/snapshots.ts", {
    "drizzle-orm": orm, "@/db": {}, "@/db/schema": tables,
    "@/lib/api-schemas": schemas, "@/lib/format": {}, "@/lib/period": period,
    ...cashMocks({
      cashIncome: async () => [],
      cashExpense: async () => ({
        salary,
        other: [{ amount: 300, method: "cash", date: "2026-10-03", category: "Продукти" }],
      }),
    }),
    "@/lib/queries": {
      childrenWithPayments: async () => [],
      paymentsSummary: () => ({ received: 0 }),
      monthExpenses: async () => [],
      salaryProgress: async () => [],
    },
  });
  return financeSnapshot(1, "2026-10");
}

const category = (result, name) => result.categories.find((row) => row.category === name);

test("Advances and salary are separate categories", async () => {
  const result = await snapshotWith([
    { amount: 1000, method: "cash", date: "2026-10-05", kind: "advance" },
    { amount: 2500.5, method: "cash", date: "2026-10-06", kind: "salary" },
    { amount: 500, method: "card", date: "2026-10-20", kind: "advance" },
  ]);
  assert.equal(category(result, "Аванс").amount, 1500);
  assert.equal(category(result, "Зарплата").amount, 2500.5);
  assert.equal(result.summary.expense.salary, 4000.5);
  assert.equal(
    category(result, "Аванс").amount + category(result, "Зарплата").amount,
    result.summary.expense.salary,
  );
});

test("A kind that was not paid is not listed", async () => {
  const result = await snapshotWith([
    { amount: 700, method: "cash", date: "2026-10-05", kind: "salary" },
  ]);
  assert.equal(category(result, "Аванс"), undefined);
  assert.equal(category(result, "Зарплата").amount, 700);
});

test("Shares are counted against all expenses", async () => {
  const result = await snapshotWith([
    { amount: 400, method: "cash", date: "2026-10-05", kind: "advance" },
    { amount: 300, method: "cash", date: "2026-10-06", kind: "salary" },
  ]);
  // 400 + 300 + 300 інших витрат = 1000.
  assert.equal(category(result, "Аванс").share, 40);
  assert.equal(category(result, "Зарплата").share, 30);
  assert.equal(category(result, "Продукти").share, 30);
});
