"use client";
import { shiftMonth } from "@/lib/period";

export function MonthPicker({ month, onChange }: {
  month: string;
  onChange: (month: string) => void;
}) {
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
    </div>
  );
}
