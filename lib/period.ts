import { MONTH } from "./api-schemas";

export const FALLBACK_MONTH = "2026-08";

export const monthStart = (month: string) =>
  `${MONTH.test(month) ? month : FALLBACK_MONTH}-01`;

export type MonthInfo = ReturnType<typeof monthInfo>;

/** All dates are built in UTC so the calendar never shifts by a day. */
export function monthInfo(month: string) {
  const safe = MONTH.test(month) ? month : FALLBACK_MONTH;
  const [year, monthNumber] = safe.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const calendar = Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.UTC(year, monthNumber - 1, index + 1));
    const weekday = date.getUTCDay();
    return {
      day: index + 1,
      date: date.toISOString().slice(0, 10),
      weekend: weekday === 0 || weekday === 6,
    };
  });
  return {
    month: safe,
    calendar,
    // Note: public holidays are not accounted for yet.
    workdays: calendar.filter((day) => !day.weekend).length,
  };
}
