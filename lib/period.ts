import { MONTH } from "./api-schemas";

/** Calendar month in the kindergarten's time zone, evaluated on each call. */
export function currentMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit",
  }).formatToParts(now);
  return parts.find((part) => part.type === "year")!.value + "-" +
    parts.find((part) => part.type === "month")!.value;
}

export function shiftMonth(month: string, delta: number) {
  const [year, number] = month.split("-").map(Number);
  const index = Math.min(9999 * 12 + 11, Math.max(12, year * 12 + number - 1 + delta));
  return String(Math.floor(index / 12)).padStart(4, "0") + "-" + String(index % 12 + 1).padStart(2, "0");
}

export function monthLabel(month: string) {
  const date = new Date(month + "-01T12:00:00Z");
  return date.toLocaleDateString("uk-UA", { month: "long", year: "numeric", timeZone: "UTC" });
}

export const monthStart = (month: string) =>
  `${MONTH.test(month) ? month : currentMonth()}-01`;

export type MonthInfo = ReturnType<typeof monthInfo>;

/** All dates are built in UTC so the calendar never shifts by a day. */
export function monthInfo(month: string) {
  const safe = MONTH.test(month) ? month : currentMonth();
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
