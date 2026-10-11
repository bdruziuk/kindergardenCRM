"use client";
import { useSyncExternalStore } from "react";
import { MONTH } from "@/lib/api-schemas";
import { currentMonth, shiftMonth } from "@/lib/period";

/**
 * Обраний місяць — один на всі сторінки місяця («Огляд», «Оплати»,
 * «Колектив», «Доходи й витрати»).
 *
 * Раніше кожна сторінка тримала свій і при відкритті починала з поточного,
 * тож перехід з «Оплат» за вересень у «Колектив» мовчки показував жовтень.
 * Тепер вибір живе, поки відкрита вкладка: у пам'яті модуля — для переходів
 * між сторінками, у sessionStorage — щоб пережити й оновлення сторінки.
 * Закрив вкладку — наступного разу знову поточний місяць.
 */
const KEY = "malecha:month";
let chosen: string | null = null;
const listeners = new Set<() => void>();

function read() {
  if (chosen === null) {
    try {
      const stored = window.sessionStorage.getItem(KEY);
      chosen = stored && MONTH.test(stored) ? stored : "";
    } catch {
      // приватний режим чи заблоковане сховище — просто не запам'ятовуємо
      chosen = "";
    }
  }
  return chosen || currentMonth();
}

function choose(month: string) {
  // Поточний не зберігаємо: інакше вкладка, відкрита до півночі останнього
  // дня місяця, лишилася б на минулому, хоча ніхто його не обирав.
  chosen = month === currentMonth() ? "" : month;
  try {
    if (chosen) window.sessionStorage.setItem(KEY, chosen);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // див. read()
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Спільний обраний місяць і спосіб його змінити. На сервері — поточний. */
export function useMonth() {
  const month = useSyncExternalStore(subscribe, read, currentMonth);
  return [month, choose] as const;
}

export function MonthPicker({ month, onChange }: {
  month: string;
  onChange: (month: string) => void;
}) {
  const today = currentMonth();
  return (
    <div className="payments-month">
      <button type="button" aria-label="Попередній місяць" disabled={month === "0001-01"} onClick={() => onChange(shiftMonth(month, -1))}>‹</button>
      <input
        type="month"
        aria-label="Місяць звіту"
        min="0001-01"
        max="9999-12"
        value={month}
        onChange={(event) => {
          const value = event.target.value;
          if (/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value)) onChange(value);
        }}
      />
      <button type="button" aria-label="Наступний місяць" disabled={month === "9999-12"} onClick={() => onChange(shiftMonth(month, 1))}>›</button>
      {/* Обраний місяць тепер тримається між сторінками, тож треба бачити,
          що дивишся не на сьогодні, — і повертатися одним кліком. */}
      {month !== today && (
        <button
          type="button"
          className="month-today"
          onClick={() => onChange(today)}
        >
          Поточний місяць
        </button>
      )}
    </div>
  );
}
