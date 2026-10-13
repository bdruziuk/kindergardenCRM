import assert from "node:assert/strict";
import test from "node:test";
import { load, schemas, ScopeError } from "./test-helpers.mjs";

// Хто закриває й відкриває місяць: власник і керуючий своєї філії — так;
// вихователь — ні, ні в який бік.

function setup({ canManageBranch }) {
  const calls = [];
  const closed = new Set();
  const { POST } = load("app/api/month-close/route.ts", {
    "@/lib/api-schemas": schemas,
    "@/lib/period": { currentMonth: () => "2026-10" },
    "@/lib/money": { sumMoney: () => 0 },
    "@/lib/month-close": {
      closeMonth: async (branchId, month) => { calls.push(["close", month]); closed.add(month); },
      openMonth: async (branchId, month) => { calls.push(["open", month]); closed.delete(month); },
      loadClose: async (branchId, month) => closed.has(month) ? { closedAt: "2026-10-11T10:00:00.000Z" } : null,
    },
    "@/lib/scope": {
      ScopeError,
      resolveScope: async () => ({ branchId: 1, userId: 7, canManageBranch }),
      scopeFailure: (error) => error instanceof ScopeError ? Response.json({ error: error.message }, { status: error.status }) : null,
    },
    "@/lib/snapshots": {
      paymentsSnapshot: async () => ({}), staffSnapshot: async () => ({}),
      financeSnapshot: async () => ({}), dashboardSnapshot: async () => ({}),
    },
  });
  const send = (action) => POST(new Request("http://localhost/api/month-close", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ month: "2026-09", action }),
  }));
  return { send, calls };
}

test("A manager closes and reopens a month of their branch", async () => {
  const { send, calls } = setup({ canManageBranch: true });
  const closing = await send("close");
  assert.equal(closing.status, 200, JSON.stringify(await closing.clone().json()));
  assert.equal((await closing.json()).closed, true);
  const opening = await send("open");
  assert.equal(opening.status, 200);
  assert.equal((await opening.json()).closed, false);
  assert.deepEqual(calls, [["close", "2026-09"], ["open", "2026-09"]]);
});

test("A teacher can neither close nor open a month", async () => {
  const { send, calls } = setup({ canManageBranch: false });
  assert.equal((await send("close")).status, 403);
  assert.equal((await send("open")).status, 403);
  assert.deepEqual(calls, []);
});
