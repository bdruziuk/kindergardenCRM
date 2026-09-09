import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Статуси черги мусять відрізнятись на око в будь-якій кольоровій схемі.
// «Зараховано» колись брало акцент філії — під синьою схемою воно ставало
// таким же синім, як «Запрошено», під жовтою таким же бежевим, як «Очікує».
// На око цього не видно, поки не переключиш схему, тож стереже тест.

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

const STATUSES = ["waiting", "invited", "enrolled", "declined"];

/** Оголошення всередині одного правила, знайденого за селектором. */
function block(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp("(?:^|[}\\n])" + escaped + "\\{([^}]*)\\}").exec(css);
  assert.ok(match, `У globals.css немає правила ${selector}`);
  return Object.fromEntries(
    match[1]
      .split(";")
      .filter((line) => line.includes(":"))
      .map((line) => {
        const at = line.indexOf(":");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
}

const palette = block(".waitlist-page");

test("Every queue status has its own colour", () => {
  for (const part of ["ink", "soft", "line"]) {
    const values = STATUSES.map((status) => {
      const value = palette[`--${status}-${part}`];
      assert.ok(value, `Не задано --${status}-${part}`);
      return value.toLowerCase();
    });
    assert.equal(
      new Set(values).size,
      STATUSES.length,
      `Однаковий ${part} у двох статусів: ${values.join(", ")}`,
    );
  }
});

test("Status colours do not follow the branch colour scheme", () => {
  // Те саме правило, що записане вгорі globals.css: колір, який несе зміст,
  // однаковий у всіх схемах. Акцент у схемах перевизначається, тож посилання
  // на нього повернуло б злиття статусів.
  for (const [name, value] of Object.entries(palette)) {
    assert.ok(
      /^#[0-9a-f]{3,8}$/i.test(value),
      `${name} має бути власним кольором, а не «${value}»`,
    );
  }
});

test("Each status colour is wired to the select, the tile and the filter", () => {
  for (const status of STATUSES) {
    const mapping = block(`.waitlist-page .${status}`);
    for (const part of ["ink", "soft", "line"]) {
      assert.equal(
        mapping[`--status-${part}`],
        `var(--${status}-${part})`,
        `Статус ${status} не підключений до --status-${part}`,
      );
    }
  }
  // Споживачі читають одне й те саме зіставлення, тож колір нізде не
  // розходиться з позначкою в рядку.
  for (const selector of [
    ".waitlist-status.waiting,.waitlist-status.invited,.waitlist-status.enrolled,.waitlist-status.declined",
    ".waitlist-page .staff-stats article>i",
    ".waitlist-page .view-switch button.active",
  ]) {
    const rule = block(selector);
    assert.match(
      Object.values(rule).join(" "),
      /var\(--status-(ink|soft)/,
      `${selector} не бере колір статусу`,
    );
  }
});
