import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas } from "./test-helpers.mjs";
const period = load("lib/period.ts", { "./api-schemas": schemas });
const queries = load("lib/queries.ts", {
  "drizzle-orm": {}, "@/db": {}, "@/db/schema": {}, "./period": period, "./format": {},
});
test("One family's overpayment does not cancel another family's debt", () => {
  const summary = queries.paymentsSummary([
    { fee: 1000, paid: 2000, status: "Сплачено" },
    { fee: 1000, paid: 0, status: "Не сплачено" },
  ]);
  assert.equal(summary.balance, 1000);
  assert.equal(summary.received, 2000);
});
test("Partial debt is preserved even when total receipts exceed the plan", () => {
  const summary = queries.paymentsSummary([
    { fee: 1000, paid: 3000, status: "Сплачено" },
    { fee: 1000, paid: 600, status: "Частково" },
  ]);
  assert.equal(summary.balance, 400);
  assert.equal(summary.received, 3600);
});
test("Debt is rounded to kopecks and empty or fully paid lists have no debt", () => {
  assert.equal(queries.paymentsSummary([{ fee: 0.3, paid: 0.1, status: "Частково" }]).balance, 0.2);
  assert.equal(queries.paymentsSummary([]).balance, 0);
  assert.equal(queries.paymentsSummary([{ fee: 1000, paid: 1000, status: "Сплачено" }]).balance, 0);
});
test("Month navigation passes the former September limit and crosses years", () => {
  assert.equal(period.shiftMonth("2026-09", 1), "2026-10");
  assert.equal(period.shiftMonth("2026-12", 1), "2027-01");
  assert.equal(period.shiftMonth("2027-01", -1), "2026-12");
  assert.equal(period.shiftMonth("2032-07", 1), "2032-08");
});
test("Default month follows Kyiv date even before UTC midnight", () => {
  assert.equal(period.currentMonth(new Date("2026-09-30T22:30:00Z")), "2026-10");
  assert.equal(period.currentMonth(new Date("2026-12-31T22:30:00Z")), "2027-01");
});
test("Calendar retains leap February and arbitrary month labels", () => {
  assert.equal(period.monthInfo("2028-02").calendar.length, 29);
  assert.equal(period.monthInfo("2027-02").calendar.length, 28);
  assert.match(period.monthLabel("2027-10"), /2027/);
  assert.equal(period.monthStart("2027-10"), "2027-10-01");
});
