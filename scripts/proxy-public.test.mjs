import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./test-helpers.mjs";

// Сторінки «Забули пароль» і «Новий пароль» відкриває саме той, хто увійти не
// може, тож їх пропускає без сесії; решта сторінок веде на вхід.
function setup(token) {
  const redirect = (url) => ({ kind: "redirect", url: String(url) });
  const { proxy } = load("proxy.ts", {
    "next-auth/jwt": { getToken: async () => token },
    "next/server": {
      NextResponse: {
        next: () => ({ kind: "next" }),
        redirect,
        json: (body, init) => ({ kind: "json", body, status: init?.status }),
      },
    },
  });
  return (path) => {
    const url = new URL(`http://localhost${path}`);
    return proxy({ nextUrl: Object.assign(url, { clone: () => new URL(url) }), url: url.href });
  };
}

test("Без сесії /reset і /forgot відкриваються, а не ведуть на вхід", async () => {
  const visit = setup(null);
  assert.equal((await visit("/reset?token=abc")).kind, "next");
  assert.equal((await visit("/forgot")).kind, "next");
  const other = await visit("/payments");
  assert.equal(other.kind, "redirect");
  assert.match(other.url, /\/login\?callbackUrl=%2Fpayments/);
});

test("Суперадміна з посиланням на /reset не перекидає в кабінет", async () => {
  const visit = setup({ role: "superadmin" });
  assert.equal((await visit("/reset?token=abc")).kind, "next");
  assert.match((await visit("/payments")).url, /\/admin$/);
});
