import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, tables, orm, fixture, database } from "./test-helpers.mjs";

function setup() {
  const data = fixture();
  for (const child of data.children) Object.assign(child, { status: "active", customFee: null });
  data.children.push({ id: 4, branchId: 1, fullName: "Former without payments", status: "left", customFee: null });
  data.payments.push(
    { id: 1, childId: 1, billingMonth: "2026-08-01", amount: 200, method: "cash", paidAt: "2026-09-03" },
    { id: 2, childId: 1, billingMonth: "2026-08-01", amount: 300, method: "card", paidAt: "2026-08-03" },
    { id: 3, childId: 1, billingMonth: "2026-08-01", amount: 100, method: "iban", paidAt: "2026-08-04" },
    { id: 4, childId: 2, billingMonth: "2026-08-01", amount: 9000, method: "cash", paidAt: "2026-08-04" },
    { id: 5, childId: 3, billingMonth: "2026-08-01", amount: 8000, method: "cash", paidAt: "2026-08-04" },
  );
  data.paymentReceipts.push({ id: 1, paymentId: 1, fileName: "receipt.pdf", mime: "application/pdf", size: 123 });
  const period = load("lib/period.ts", { "./api-schemas": schemas });
  const queries = load("lib/queries.ts", {
    "drizzle-orm": orm, "@/db": { getDb: () => database(data) }, "@/db/schema": tables,
    "./period": period, "./format": { initialsOf: () => "C" },
  });
  const snapshots = load("lib/snapshots.ts", {
    "drizzle-orm": orm, "@/db": { getDb: () => database(data) }, "@/db/schema": tables,
    "@/lib/api-schemas": schemas, "@/lib/format": {}, "@/lib/period": period,
    "@/lib/queries": { ...queries, salaryProgress: async () => [], monthExpenses: async () => [] },
  });
  return { data, queries, snapshots };
}

test("Leaving does not remove partial payments, debt, or receipt history", async () => {
  const { data, queries } = setup();
  const before = await queries.childrenWithPayments(1, "2026-08");
  Object.assign(data.children[0], { status: "left", leftAt: "2026-08-20" });
  const after = await queries.childrenWithPayments(1, "2026-08");
  assert.deepEqual(after, before);
  assert.equal(after.length, 1);
  assert.equal(after[0].paid, 600);
  assert.equal(after[0].balance, 400);
  assert.equal(after[0].status, "Частково");
  assert.equal(after[0].history[0].receipt.name, "receipt.pdf");
});

test("Payments and finance totals retain all payment methods after leaving", async () => {
  const { data, snapshots } = setup();
  const before = await snapshots.financeSnapshot(1, "2026-08");
  data.children[0].status = "left";
  const after = await snapshots.financeSnapshot(1, "2026-08");
  assert.deepEqual(after, before);
  assert.equal(after.summary.income, 600);
  assert.deepEqual(after.methods.map(({ method, income }) => [method, income]), [["cash", 200], ["iban", 100], ["card", 300]]);
  const payments = await snapshots.paymentsSnapshot(1, "2026-08");
  assert.equal(payments.summary.received, after.summary.income);
});

test("Former children without payments in the selected month are not billed", async () => {
  const { data, queries } = setup();
  data.children[0].status = "left";
  assert.deepEqual(await queries.childrenWithPayments(1, "2026-09"), []);
});

test("Paid-at date and other branches do not affect billing-month income", async () => {
  const { data, queries } = setup();
  data.children[0].status = "left";
  const rows = await queries.childrenWithPayments(1, "2026-08");
  const branchChildIds = new Set(data.children.filter((child) => child.branchId === 1).map((child) => child.id));
  const ledgerTotal = data.payments.filter((payment) => branchChildIds.has(payment.childId) && payment.billingMonth === "2026-08-01").reduce((total, payment) => total + payment.amount, 0);
  assert.equal(queries.paymentsSummary(rows).received, ledgerTotal);
  assert.deepEqual(rows[0].history.map((payment) => payment.id), [1, 2, 3]);
});

test("Current children without payments still have their monthly fee", async () => {
  const { queries } = setup();
  const rows = await queries.childrenWithPayments(1, "2026-09");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fee, 1000);
  assert.equal(rows[0].paid, 0);
  assert.equal(rows[0].balance, 1000);
});
