import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { monthCloses } from "@/db/schema";
import { monthStart } from "./period";
import { ScopeError } from "./scope";

/**
 * Закриття місяця.
 *
 * Сторінки місяця рахуються з довідників, які змінюються далі: плата за садок,
 * ставки, склад дітей і персоналу. Перерахунок минулого сьогоднішніми
 * значеннями показував би неправду, тож закритий місяць віддається зі знімка й
 * більше не редагується.
 *
 * Знімок — обчислені сторінки, а не сировина: мета саме в тому, щоб показати
 * рівно те, що бачили на момент закриття.
 */
export type MonthSnapshot = {
  payments: unknown;
  staff: unknown;
  finances: unknown;
  /** Може бути відсутнім у знімках, знятих до появи «Огляду» в закритті. */
  dashboard?: unknown;
};

export type CloseState = {
  closed: boolean;
  closedAt: string | null;
};

/** Знімок закритого місяця, або null, якщо місяць відкритий. */
export async function loadClose(branchId: number, month: string) {
  const [row] = await getDb()
    .select({
      data: monthCloses.data,
      closedAt: monthCloses.closedAt,
    })
    .from(monthCloses)
    .where(
      and(
        eq(monthCloses.branchId, branchId),
        eq(monthCloses.month, monthStart(month)),
      ),
    );
  if (!row) return null;

  return {
    closedAt: row.closedAt.toISOString(),
    snapshot: JSON.parse(row.data) as MonthSnapshot,
  };
}

/**
 * Кожна зміна, що потрапляє в закритий місяць, відхиляється тут.
 *
 * Перевірка стоїть у маршрутах, а не в інтерфейсі: сховати кнопку недостатньо,
 * бо запит можна надіслати й повз неї, а мовчки прийнята зміна розійшлася б зі
 * знімком, який і далі показують.
 */
export async function assertMonthOpen(branchId: number, month: string) {
  const closed = await loadClose(branchId, month);
  if (closed)
    throw new ScopeError(
      "Місяць закрито — щоб змінювати, спершу відкрийте його",
      409,
    );
}

export async function closeMonth(
  branchId: number,
  month: string,
  userId: number,
  snapshot: MonthSnapshot,
) {
  await getDb()
    .insert(monthCloses)
    .values({
      branchId,
      month: monthStart(month),
      data: JSON.stringify(snapshot),
      closedBy: userId,
    })
    // Повторне закриття не має перезаписувати знімок: тоді «закрити ще раз»
    // тихо оновило б минуле сьогоднішніми числами — рівно те, чого уникаємо.
    .onConflictDoNothing();
}

export async function openMonth(branchId: number, month: string) {
  await getDb()
    .delete(monthCloses)
    .where(
      and(
        eq(monthCloses.branchId, branchId),
        eq(monthCloses.month, monthStart(month)),
      ),
    );
}
