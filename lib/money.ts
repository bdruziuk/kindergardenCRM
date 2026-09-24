/**
 * Гроші рахуються в копійках.
 *
 * У базі суми лежать як numeric(12,2) і читаються числами, але складати їх
 * числами з комою не можна: 0.1 + 0.2 дає 0.30000000000000004, і на сотні
 * виплат похибка вилазить у підсумку. Тому кожна сума переводиться в цілі
 * копійки, додається там і повертається назад уже округленою.
 */

/** Сума в копійках: єдине місце, де відбувається округлення до копійки. */
export const kopecks = (amount: number) => Math.round(amount * 100);

/** Копійки назад у гривні з рівно двома знаками. */
export const hryvnia = (value: number) => value / 100;

/** Округлення однієї суми до копійки. */
export const money = (amount: number) => hryvnia(kopecks(amount));

/** Сума списку без накопичення похибки: додаємо цілі копійки. */
export function sumMoney<T>(rows: readonly T[], pick: (row: T) => number) {
  return hryvnia(rows.reduce((total, row) => total + kopecks(pick(row)), 0));
}

/** Різниця двох сум, порахована в копійках. */
export const diffMoney = (left: number, right: number) =>
  hryvnia(kopecks(left) - kopecks(right));
