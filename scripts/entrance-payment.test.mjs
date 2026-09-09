import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, fixture, database } from "./test-helpers.mjs";
const period = load("lib/period.ts", { "./api-schemas": schemas });
for (const method of ["cash", "card", "iban"]) test(`Entrance contribution: ${method}, income without tuition debt offset`, async () => {
  const data = fixture();
  Object.assign(data.children[0], { status: "active", feeMode: "monthly", customFee: 1000 });
  data.payments.push(
    { id: 1, childId: 1, billingMonth: "2026-09-01", purpose: "entrance", amount: 2000, method, paidAt: "2026-09-09" },
    { id: 2, childId: 1, billingMonth: "2026-09-01", purpose: "tuition", amount: 400, method, paidAt: "2026-09-09" },
  );
  const queries = load("lib/queries.ts", {
    "drizzle-orm": orm, "@/db": { getDb: () => database(data) }, "@/db/schema": tables,
    "./period": period, "./format": { initialsOf: () => "C" },
  });
  const rows = await queries.childrenWithPayments(1, "2026-09");
  assert.equal(rows[0].paid, 400);
  assert.equal(rows[0].entrancePaid, 2000);
  assert.equal(rows[0].balance, 600);
  assert.equal(rows[0].status, "Частково");
  assert.equal(rows[0].history[0].purpose, "entrance");
  const summary = queries.paymentsSummary(rows);
  assert.equal(summary.received, 2400);
  assert.equal(summary.balance, 600);
  assert.equal(summary.progress, 40);
  const { financeSnapshot } = load("lib/snapshots.ts", {
    "drizzle-orm": orm, "@/db": {}, "@/db/schema": tables, "@/lib/api-schemas": schemas,
    "@/lib/period": period, "@/lib/format": {},
    "@/lib/queries": { ...queries, salaryProgress: async () => [], monthExpenses: async () => [] },
  });
  const finance = await financeSnapshot(1, "2026-09");
  assert.equal(finance.summary.income, 2400);
  assert.equal(finance.methods.find((row) => row.method === method).income, 2400);
  data.children[0].status = "left";
  assert.equal((await financeSnapshot(1, "2026-09")).summary.income, 2400);
  data.payments.shift();
  assert.equal((await financeSnapshot(1, "2026-09")).summary.income, 400);
});
test("Contribution is optional; existing requests default to tuition", () => {
  const body = { kind: "add", childId: 1, month: "2026-09", amount: 2000, method: "cash" };
  assert.equal(schemas.paymentRequest.parse(body).purpose, "tuition");
  assert.equal(schemas.paymentRequest.parse({ ...body, purpose: "entrance" }).purpose, "entrance");
  assert.equal(schemas.paymentRequest.safeParse({ ...body, purpose: "bad" }).success, false);
});
