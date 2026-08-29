// Presentation helpers. These labels used to be stored in the database
// ("12 500 ₴", "4 роки", "Активна"); they are now derived from real values.

/** 12500 -> "12 500". Plain spaces, so the output is byte-stable across
 *  platforms unlike toLocaleString, which uses a narrow no-break space. */
export function groupDigits(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const [whole, fraction] = rounded.toFixed(2).split(".");
  const spaced = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return fraction === "00" ? spaced : `${spaced},${fraction}`;
}

export const moneyLabel = (value: number): string => `${groupDigits(value)} ₴`;

/** Ukrainian plural: picks the form by the trailing digits.
 *  1 рік · 2–4 роки · 5–20 років, then repeating by the last digit. */
export function plural(
  count: number,
  one: string,
  few: string,
  many: string,
): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export const yearsLabel = (years: number) =>
  `${years} ${plural(years, "рік", "роки", "років")}`;

export const monthsLabel = (count: number) =>
  `${count} ${plural(count, "місяць", "місяці", "місяців")}`;

export function ageFromBirthDate(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const born = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < born.getUTCDate()))
    age -= 1;
  return age >= 0 ? age : null;
}

export function ageLabel(birthDate: string | null): string {
  const age = ageFromBirthDate(birthDate);
  return age === null ? "—" : yearsLabel(age);
}

/** Inverse of ageLabel: "4 роки" -> 1 January of the implied birth year.
 *  Returns null when the label carries no number, e.g. "—". */
export function birthDateFromAgeLabel(label: string): string | null {
  const digits = label.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const years = Number(digits);
  if (!Number.isFinite(years) || years < 0 || years > 120) return null;
  return `${new Date().getUTCFullYear() - years}-01-01`;
}

/** "12 500 ₴" / "12500,50" -> 12500 / 12500.5 */
export function parseMoney(input: string | number): number {
  if (typeof input === "number") return Number.isFinite(input) ? input : 0;
  const cleaned = input.replace(/[^0-9,.-]/g, "").replace(",", ".");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}

export function initialsOf(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export const CHILD_STATUS_LABELS = {
  active: "Активна",
  paused: "Пауза",
  left: "Вибула",
} as const;

/** Оплата рахується від занять, а не від відпрацьованих днів. Об'єднує два
 *  типи, тож усі місця, де це важливо, питають тут, а не звіряють рядок. */
export const paidByLesson = (salaryType: string) =>
  salaryType === "lesson" || salaryType === "base_lesson";

export const SALARY_TYPE_LABELS = {
  monthly: "Місячна ставка",
  daily: "Оплата за день",
  lesson: "Оплата за заняття",
  base_lesson: "Ставка + за заняття",
} as const;

export const lessonsLabel = (count: number) =>
  `${count} ${plural(count, "заняття", "заняття", "занять")}`;

export const ATTENDANCE_KIND_LABELS = {
  worked: "Відпрацьовано",
  absent: "Не відпрацьовано",
  vacation: "Оплачувана відпустка",
  day_off: "Оплачуваний вихідний",
} as const;

/** Single-character cell marks for the month grid and calendar. */
export const ATTENDANCE_KIND_MARKS = {
  worked: "✓",
  absent: "×",
  vacation: "В",
  day_off: "О",
} as const;

/** Genitive month names: uk-UA "long" gives the nominative ("вересень"),
 *  which reads wrong after a preposition — "з вересня", not "з вересень". */
const MONTHS_GENITIVE = [
  "січня",
  "лютого",
  "березня",
  "квітня",
  "травня",
  "червня",
  "липня",
  "серпня",
  "вересня",
  "жовтня",
  "листопада",
  "грудня",
];

/** "2027-09" -> "вересня 2027" */
export function monthGenitive(month: string): string {
  const [year, index] = month.split("-").map(Number);
  const name = MONTHS_GENITIVE[index - 1];
  return name ? `${name} ${year}` : month;
}

/** Наскільки перевищено ліміти оплачуваної відсутності: скільки днів понад
 *  норму взято відпустки за рік і оплачуваних вихідних за місяць. Нульова
 *  квота означає «ліміт не заданий», а не «жодного дня», тож її не перевіряємо;
 *  оплата за заняття взагалі не рахує дні, тож ліміти до неї не застосовні. */
export function leaveOverrun(person: {
  salaryType: string;
  vacationQuota: number;
  vacationUsedYear: number;
  dayOffQuota: number;
  dayOffDays: number;
}) {
  const counts = !paidByLesson(person.salaryType);
  const vacation =
    counts && person.vacationQuota
      ? Math.max(person.vacationUsedYear - person.vacationQuota, 0)
      : 0;
  const dayOff =
    counts && person.dayOffQuota
      ? Math.max(person.dayOffDays - person.dayOffQuota, 0)
      : 0;
  return { vacation, dayOff, over: vacation > 0 || dayOff > 0 };
}

/** Текст попередження про перевищення, або null, якщо все в межах. */
export function leaveWarning(person: {
  name: string;
  salaryType: string;
  vacationQuota: number;
  vacationUsedYear: number;
  dayOffQuota: number;
  dayOffDays: number;
}): string | null {
  const { vacation, dayOff } = leaveOverrun(person);
  const parts = [
    vacation &&
      `відпустка ${person.vacationUsedYear} із ${person.vacationQuota} днів на рік`,
    dayOff &&
      `оплачувані вихідні ${person.dayOffDays} із ${person.dayOffQuota} днів на місяць`,
  ].filter(Boolean);
  return parts.length
    ? `${person.name}: ліміт перевищено — ${parts.join("; ")}.`
    : null;
}

/** "2026-09-01" -> "1 вересня 2026" */
export function dayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const name = MONTHS_GENITIVE[month - 1];
  return name ? `${day} ${name} ${year}` : date;
}

/** Назви кольорових схем. Живуть тут, а не в lib/theme.ts, бо той тягне сесію
 *  й базу — клієнтським сторінкам його імпортувати не можна. */
export const THEME_LABELS = {
  green: "Зелена",
  blue: "Синя",
  red: "Червона",
  yellow: "Жовта",
} as const;

export const USER_ROLE_LABELS = {
  superadmin: "Супер-адміністратор",
  admin: "Власник",
  manager: "Керуючий філією",
  teacher: "Вихователь",
} as const;

export const WAITLIST_STATUS_LABELS = {
  waiting: "У черзі",
  invited: "Запрошено",
  enrolled: "Зараховано",
  declined: "Відмовились",
} as const;

export const SALARY_KIND_LABELS = {
  advance: "Аванс",
  salary: "Зарплата",
} as const;

export const PAYMENT_METHOD_LABELS = {
  cash: "Готівка",
  iban: "IBAN",
  card: "Карта",
} as const;

type Reverse<T extends Record<string, string>> = {
  [K in keyof T as T[K]]: K;
};

const reverse = <T extends Record<string, string>>(map: T): Reverse<T> =>
  Object.fromEntries(
    Object.entries(map).map(([key, label]) => [label, key]),
  ) as Reverse<T>;

export const CHILD_STATUS_BY_LABEL = reverse(CHILD_STATUS_LABELS);
export const PAYMENT_METHOD_BY_LABEL = reverse(PAYMENT_METHOD_LABELS);
