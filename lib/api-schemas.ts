import { z } from "zod";

export const MONTH = /^\d{4}-\d{2}$/;
export const DAY = /^\d{4}-\d{2}-\d{2}$/;

const month = z.string().regex(MONTH, "Очікується місяць у форматі YYYY-MM");
const day = z.string().regex(DAY, "Очікується дата у форматі YYYY-MM-DD");
const id = z.number({ error: "Не вказано запис" }).int().positive("Некоректний запис");
const amount = z.coerce.number().nonnegative();

export const childStatusValues = ["active", "paused", "left"] as const;
export const paymentMethodValues = ["cash", "iban", "card"] as const;
export const salaryTypeValues = ["monthly", "daily", "lesson"] as const;
export const salaryKindValues = ["advance", "salary"] as const;
export const waitlistStatusValues = [
  "waiting",
  "invited",
  "enrolled",
  "declined",
] as const;
export const userRoleValues = [
  "superadmin",
  "admin",
  "manager",
  "teacher",
] as const;
export type UserRole = (typeof userRoleValues)[number];
export const colorThemeValues = ["green", "blue", "red", "yellow"] as const;
export type ColorTheme = (typeof colorThemeValues)[number];
export const attendanceKindValues = [
  "worked",
  "absent",
  "vacation",
  "day_off",
] as const;

// ---------------------------------------------------------------- kindergarten

export const relativeInput = z.object({
  name: z.string().trim().min(1),
  note: z.string().trim().default("Родич"),
  phone: z.string().trim().default(""),
});

export const childInput = z.object({
  fullName: z.string().trim().min(1, "Ім’я обов’язкове"),
  birthDate: day.nullable().default(null),
  groupName: z.string().trim().min(1, "Оберіть групу"),
  fee: amount,
  /** Коли дитина зарахована й коли вибула; null — «невідомо», і тоді дитина
   *  рахується в будь-якому періоді. */
  enrolledAt: day.nullable().default(null),
  leftAt: day.nullable().default(null),
  status: z
    .enum(childStatusValues, { error: "Невідомий статус дитини" })
    .default("active"),
  relatives: z.array(relativeInput).default([]),
});

const unknownAction = { error: "Невідома дія" };

export const kindergartenRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("group"),
    name: z.string().trim().min(1, "Назва обов’язкова"),
    ageRange: z.string().trim().default("3–4 роки"),
  }),
  z.object({
    kind: z.literal("update_group"),
    groupId: id,
    name: z.string().trim().min(1, "Назва обов’язкова"),
    ageRange: z.string().trim().default("3–4 роки"),
  }),
  z.object({ kind: z.literal("child"), child: childInput }),
  z.object({
    kind: z.literal("update_child"),
    childId: id,
    child: childInput,
  }),
], unknownAction);

export type RelativeInput = z.infer<typeof relativeInput>;
export type ChildInput = z.infer<typeof childInput>;

// -------------------------------------------------------------------- payments

export const paymentRequest = z.object({
  childId: id,
  month,
  amount: z.coerce.number().positive("Сума має бути більшою за нуль"),
  method: z.enum(paymentMethodValues, { error: "Невідомий спосіб оплати" }),
  paidAt: day.optional(),
});

// ----------------------------------------------------------------------- staff

const rateFields = {
  salaryType: z.enum(salaryTypeValues).default("monthly"),
  monthlyRate: amount.default(0),
  dailyRate: amount.default(0),
  lessonRate: amount.default(0),
  vacationQuota: z.coerce.number().int().min(0).max(365).default(0),
  dayOffQuota: z.coerce.number().int().min(0).max(31).default(0),
};

export const staffRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("attendance"),
    staffId: id,
    date: day,
    state: z.enum([...attendanceKindValues, "unmarked"]),
    month: month.optional(),
  }),
  z.object({
    kind: z.literal("update_staff"),
    staffId: id,
    name: z.string().trim().min(1, "Ім’я обов’язкове"),
    role: z.string().trim().default("Вихователь"),
    birthDate: day.nullable().default(null),
    month: month.optional(),
    ...rateFields,
  }),
  z.object({
    kind: z.literal("staff"),
    name: z.string().trim().min(1, "Ім’я обов’язкове"),
    role: z.string().trim().default("Вихователь"),
    birthDate: day.nullable().default(null),
    month: month.optional(),
    ...rateFields,
  }),
  z.object({
    kind: z.literal("lesson_add"),
    staffId: id,
    date: day,
    note: z.string().trim().max(200).default(""),
    month: month.optional(),
  }),
  z.object({
    kind: z.literal("lesson_note"),
    lessonId: id,
    note: z.string().trim().max(200).default(""),
    month: month.optional(),
  }),
  z.object({
    kind: z.literal("lesson_remove"),
    lessonId: id,
    month: month.optional(),
  }),
  z.object({
    kind: z.literal("payout_add"),
    staffId: id,
    payoutKind: z.enum(salaryKindValues, { error: "Оберіть аванс або зарплату" }),
    amount: z.coerce.number().positive("Сума має бути більшою за нуль"),
    paidAt: day,
    note: z.string().trim().max(200).default(""),
    month: month.optional(),
  }),
  z.object({
    kind: z.literal("payout_remove"),
    payoutId: id,
    month: month.optional(),
  }),
], unknownAction);

// ---------------------------------------------------------------- transactions

export const transactionRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("add"),
    category: z.string().trim().min(1, "Вкажіть категорію").max(60),
    amount: z.coerce.number().positive("Сума має бути більшою за нуль"),
    occurredAt: day,
    note: z.string().trim().max(200).default(""),
    month: month.optional(),
  }),
  z.object({
    kind: z.literal("remove"),
    transactionId: id,
    month: month.optional(),
  }),
], unknownAction);

// -------------------------------------------------------------------- waitlist

const waitlistEntry = {
  childName: z.string().trim().min(1, "Вкажіть ім’я дитини").max(120),
  childBirthDate: day.nullable().default(null),
  parentName: z.string().trim().min(1, "Вкажіть ім’я контактної особи").max(120),
  parentPhone: z.string().trim().min(1, "Вкажіть телефон").max(40),
  parentEmail: z.string().trim().max(120).default(""),
  /** null = no preference */
  preferredGroupId: id.nullable().default(null),
  desiredFrom: month.nullable().default(null),
  note: z.string().trim().max(400).default(""),
};

const year = z.coerce
  .number({ error: "Вкажіть рік" })
  .int()
  .min(1990, "Рік має бути не раніший за 1990")
  .max(2100, "Рік має бути не пізніший за 2100");

const categoryFields = {
  name: z.string().trim().min(1, "Назва категорії обов’язкова"),
  fromYear: year,
  toYear: year,
};

export const waitlistRequest = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add"), ...waitlistEntry }),
  z.object({ kind: z.literal("update"), entryId: id, ...waitlistEntry }),
  z.object({
    kind: z.literal("status"),
    entryId: id,
    status: z.enum(waitlistStatusValues, { error: "Невідомий статус" }),
  }),
  z.object({ kind: z.literal("remove"), entryId: id }),
  z.object({ kind: z.literal("category_add"), ...categoryFields }),
  z.object({
    kind: z.literal("category_update"),
    categoryId: id,
    ...categoryFields,
  }),
  z.object({ kind: z.literal("category_remove"), categoryId: id }),
], unknownAction);

// -------------------------------------------------------------------- branches

export const branchRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    name: z.string().trim().min(1, "Назва філії обов’язкова").max(80),
    address: z.string().trim().max(200).default(""),
    monthlyFee: z.coerce.number().nonnegative().default(0),
  }),
  z.object({
    kind: z.literal("rename"),
    branchId: id,
    name: z.string().trim().min(1, "Назва філії обов’язкова").max(80),
    address: z.string().trim().max(200).default(""),
    monthlyFee: z.coerce.number().nonnegative().default(0),
  }),
  z.object({
    kind: z.literal("assign"),
    userId: id,
    /** null hands the person back to the owner role. */
    branchId: id.nullable().default(null),
  }),
], unknownAction);

// ------------------------------------------------------------------- responses

export type GroupDto = {
  id: number;
  name: string;
  ageRange: string;
  childCount: number;
  icon: string;
  color: string;
};

export type RelativeDto = { name: string; note: string; phone: string };

export type ChildDto = {
  id: number;
  fullName: string;
  initials: string;
  ageLabel: string;
  birthDate: string | null;
  groupName: string;
  fee: number;
  feeLabel: string;
  customFee: boolean;
  status: (typeof childStatusValues)[number];
  enrolledAt: string | null;
  leftAt: string | null;
  relatives: RelativeDto[];
};

export type KindergartenSnapshot = {
  groups: GroupDto[];
  children: ChildDto[];
};

export type PaymentMethod = (typeof paymentMethodValues)[number];

export type PaymentEntry = {
  id: number;
  amount: number;
  method: PaymentMethod;
  paidAt: string;
};

export type ChildPaymentsDto = {
  id: number;
  name: string;
  initials: string;
  group: string;
  fee: number;
  paid: number;
  balance: number;
  status: "Сплачено" | "Частково" | "Не сплачено";
  history: PaymentEntry[];
};

export type PaymentsSummary = {
  planned: number;
  received: number;
  balance: number;
  progress: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
};

export type PaymentsSnapshot = {
  month: string;
  rows: ChildPaymentsDto[];
  summary: PaymentsSummary;
  error?: string;
};

export type SalaryType = (typeof salaryTypeValues)[number];

export type LessonDto = { id: number; note: string };

export type SalaryKind = (typeof salaryKindValues)[number];
export type AttendanceKind = (typeof attendanceKindValues)[number];

export type PayoutDto = {
  id: number;
  kind: SalaryKind;
  amount: number;
  paidAt: string;
  note: string;
};

export type StaffRowDto = {
  id: number;
  name: string;
  role: string;
  birthDate: string | null;
  branch: string;
  salaryType: SalaryType;
  monthlyRate: number;
  dailyRate: number;
  lessonRate: number;
  /** Paid vacation allowed per calendar year. */
  vacationQuota: number;
  /** Paid days off allowed per month. */
  dayOffQuota: number;
  workedDays: number;
  absentDays: number;
  vacationDays: number;
  dayOffDays: number;
  /** worked + paid leave — what the monthly and daily rates are applied to. */
  paidDays: number;
  /** Vacation already taken this calendar year, against `vacationQuota`.
   *  Paid days off are monthly, so `dayOffDays` is their usage. */
  vacationUsedYear: number;
  /** Lessons taught in the month, keyed by "YYYY-MM-DD". */
  lessons: Record<string, LessonDto[]>;
  lessonCount: number;
  /** What the timesheet accrues for the month. */
  salary: number;
  /** What has actually been handed over for that month. */
  payouts: PayoutDto[];
  paidOut: { advance: number; salary: number; total: number };
  /** accrued − paid out; negative means overpaid. */
  remaining: number;
  marks: Record<string, AttendanceKind>;
};

export type CalendarDay = { day: number; date: string; weekend: boolean };

/** Someone whose birthday falls today or within the next few days. */
export type BirthdayDto = {
  kind: "child" | "staff";
  id: number;
  name: string;
  /** Occurrence being celebrated, "YYYY-MM-DD". */
  date: string;
  /** 0 = today. */
  daysAway: number;
  /** Age they turn, or null when the year of birth is unknown. */
  turning: number | null;
  /** Group for a child, role for a staff member. */
  detail: string;
};

export type StaffSnapshot = {
  month: string;
  calendar: CalendarDay[];
  workdays: number;
  rows: StaffRowDto[];
  summary: {
    staffCount: number;
    workedDays: number;
    absentDays: number;
    lessonCount: number;
    vacationDays: number;
    dayOffDays: number;
    /** Accrued for the month. */
    salaryTotal: number;
    /** Handed over for the month. */
    paidOutTotal: number;
  };
  error?: string;
};

/** A hand-entered expense. Income is not part of this ledger: the only money
 *  coming in is the monthly fee, which is derived from `payments`. */
export type ExpenseDto = {
  id: number;
  category: string;
  amount: number;
  occurredAt: string;
  note: string;
};

/** Salary progress for one person in the selected payroll month. */
export type SalaryRowDto = {
  id: number;
  name: string;
  role: string;
  accrued: number;
  paid: number;
  remaining: number;
  /** Share of the accrued amount already handed over, 0–100. */
  progress: number;
};

export type CategoryTotal = {
  category: string;
  amount: number;
  share: number;
};

export type FinanceSnapshot = {
  month: string;
  rows: ExpenseDto[];
  salaryRows: SalaryRowDto[];
  summary: {
    /** Parent payments received this month. */
    income: number;
    /** Cash that left this month: salary handed over plus other expenses. */
    expense: { salary: number; other: number; total: number };
    /** What the timesheet accrued this month, for comparison with
     *  `expense.salary`. Not part of the balance. */
    salaryAccrued: number;
    /** Accrued but not yet handed over. */
    salaryRemaining: number;
    balance: number;
  };
  /** Expense structure, salary included, shares relative to total expenses. */
  categories: CategoryTotal[];
  error?: string;
};

export type WaitlistStatus = (typeof waitlistStatusValues)[number];

export type WaitlistEntryDto = {
  id: number;
  childName: string;
  childBirthDate: string | null;
  ageLabel: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  preferredGroupId: number | null;
  preferredGroupName: string;
  /** "YYYY-MM" the family wants to start from, or null. */
  desiredFrom: string | null;
  status: WaitlistStatus;
  note: string;
  createdAt: string;
};

/** Вікова категорія черги: назва й діапазон років народження, обидва включно. */
export type AgeCategoryDto = {
  id: number;
  name: string;
  fromYear: number;
  toYear: number;
};

export type WaitlistSnapshot = {
  rows: WaitlistEntryDto[];
  groups: { id: number; name: string }[];
  /** Від найстарших дітей до наймолодших — у такому ж порядку йде й черга. */
  categories: AgeCategoryDto[];
  summary: Record<WaitlistStatus, number> & { total: number };
  error?: string;
};

// -------------------------------------------------------------------- settings

const theme = z.enum(colorThemeValues, { error: "Невідома кольорова схема" });

export const settingsRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("name"),
    userId: id,
    name: z.string().trim().min(1, "ПІБ обов’язкове").max(120),
  }),
  z.object({ kind: z.literal("personal_theme"), theme: theme.nullable() }),
  z.object({
    kind: z.literal("branch_theme"),
    branchId: id,
    /** null — прибрати власну схему філії й повернутись до типової. */
    theme: theme.nullable(),
  }),
  z.object({
    kind: z.literal("invite_create"),
    email: z.string().trim().toLowerCase().pipe(z.email("Некоректна пошта")),
    // Власника не запрошують: перший заводиться змінними середовища, далі
    // роль підвищують на сторінці «Філії», знімаючи прив'язку до філії.
    role: z.enum(["manager", "teacher"], { error: "Оберіть роль" }),
    branchId: id.nullable().default(null),
    days: z.coerce.number().int().min(1).max(30).default(7),
  }),
  z.object({ kind: z.literal("invite_revoke"), inviteId: id }),
  z.object({
    kind: z.literal("branch_details"),
    branchId: id,
    name: z.string().trim().min(1, "Назва філії обов’язкова").max(120),
    address: z.string().trim().max(200).default(""),
  }),
], unknownAction);

export type AccountDto = {
  id: number;
  /** ПІБ; порожній рядок, поки його не заповнили. */
  name: string;
  email: string;
  role: UserRole;
  /** Назва філії керуючого; у власника порожня — він не прив’язаний до однієї. */
  branchName: string;
};

export const registerRequest = z.object({
  token: z.string().min(1, "Немає токена запрошення"),
  name: z.string().trim().min(1, "ПІБ обов’язкове").max(120),
  password: z.string().min(8, "Пароль має бути щонайменше 8 символів").max(200),
});

export type InviteDto = {
  id: number;
  email: string;
  role: UserRole;
  branchName: string;
  expiresAt: string;
  /** "waiting" — чинне, "expired" — вийшов термін, "accepted" — уже використане. */
  status: "waiting" | "expired" | "accepted";
};

// ----------------------------------------------------------------- admin

export const adminRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("kindergarten_create"),
    name: z.string().trim().min(1, "Назва садочка обов’язкова").max(120),
  }),
  z.object({
    kind: z.literal("kindergarten_rename"),
    kindergartenId: id,
    name: z.string().trim().min(1, "Назва садочка обов’язкова").max(120),
  }),
  z.object({
    kind: z.literal("owner_invite"),
    kindergartenId: id,
    email: z.string().trim().toLowerCase().pipe(z.email("Некоректна пошта")),
    days: z.coerce.number().int().min(1).max(30).default(7),
  }),
  z.object({ kind: z.literal("admin_invite_revoke"), inviteId: id }),
], unknownAction);

export type AdminPersonDto = {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  /** Філія керуючого; у власника порожня. */
  branchName: string;
};

export type AdminBranchDto = {
  id: number;
  name: string;
  address: string;
  groups: number;
  /** Діти, які не вибули. */
  children: number;
};

export type AdminKindergartenDto = {
  id: number;
  name: string;
  createdAt: string;
  branches: AdminBranchDto[];
  owners: AdminPersonDto[];
  managers: AdminPersonDto[];
  totals: {
    branches: number;
    groups: number;
    children: number;
    people: number;
  };
  /** Запрошення власників саме цього садочка. */
  invites: InviteDto[];
};

export type AdminSnapshot = {
  kindergartens: AdminKindergartenDto[];
  totals: {
    kindergartens: number;
    branches: number;
    groups: number;
    children: number;
  };
  /** Посилання щойно створеного запрошення — повертається один раз. */
  newInviteUrl?: string;
  error?: string;
};

export type BranchSettingsDto = {
  id: number;
  name: string;
  address: string;
  /** null — філія користується типовою схемою. */
  theme: ColorTheme | null;
  /** Схему поставив власник; керуючий її вже не змінює. */
  lockedByOwner: boolean;
  /** Чи може той, хто дивиться, змінити схему саме цієї філії. */
  canEditTheme: boolean;
  /** Чи може він міняти назву й адресу — це робота власника. */
  canEditDetails: boolean;
};

export type SettingsSnapshot = {
  me: AccountDto;
  /** Садочок, у якому працює той, хто дивиться. */
  kindergartenName: string;
  /** Решта акаунтів — лише для власника. Керуючий бачить тільки себе, тож у
   *  нього цей список завжди порожній. */
  others: AccountDto[];
  /** Особиста схема власника; у керуючого завжди null — він міняє схему філії. */
  personalTheme: ColorTheme | null;
  /** Схема, у якій зараз намальований інтерфейс. */
  activeTheme: ColorTheme;
  /** Філії, доступні для налаштування: власнику — усі, керуючому — його одна. */
  branches: BranchSettingsDto[];
  /** Запрошення — лише для власника; у керуючого список завжди порожній. */
  invites: InviteDto[];
  /** Посилання щойно створеного запрошення. Повертається рівно один раз:
   *  у базі лежить тільки хеш, тож відновити його потім нізвідки. */
  newInviteUrl?: string;
  error?: string;
};

/** Що показати на сторінці реєстрації до того, як людина щось увела. */
export type InviteCheckDto = {
  email: string;
  role: UserRole;
  branchName: string;
  error?: string;
};

export type ReportMonthDto = {
  /** "YYYY-MM" */
  month: string;
  income: number;
  salaryPaid: number;
  otherExpenses: number;
  expenses: number;
  balance: number;
};

export type ReportsSnapshot = {
  /** Which scope the totals below cover. */
  period: "year" | "month";
  year: number;
  /** "YYYY-MM" when period is "month". */
  month: string | null;
  /** Always the twelve months of `year`, so a monthly report still shows
   *  where the selected month sits in the year. */
  months: ReportMonthDto[];
  totals: {
    income: number;
    salaryPaid: number;
    otherExpenses: number;
    expenses: number;
    balance: number;
    bestMonth: string | null;
  };
  /** Expense structure for the year, salary included. */
  categories: CategoryTotal[];
  /** Наповнюваність груп за той самий період, що й решта звіту. */
  groups: { name: string; children: number }[];
  /** Діти за період звіту, а не станом на сьогодні: `inPeriod` — скільки їх
   *  було в садочку хоч один день періоду, `joined` / `left` — скільки за цей
   *  час прийшло й вибуло, `paused` — скільки на паузі зараз. */
  children: {
    inPeriod: number;
    joined: number;
    left: number;
    paused: number;
  };
  /** Salary handed over during the period, per person. `accrued` and
   *  `remaining` are filled in only for a monthly report — computing them for
   *  a whole year would mean recomputing every timesheet. */
  staff: {
    id: number;
    name: string;
    role: string;
    paid: number;
    accrued: number | null;
    remaining: number | null;
  }[];
  waitlist: Record<WaitlistStatus, number> & { total: number };
  error?: string;
};

export type BranchDto = {
  id: number;
  name: string;
  address: string;
  monthlyFee: number;
  children: number;
  staff: number;
  managers: { id: number; name: string; email: string }[];
};

export type BranchesSnapshot = {
  branches: BranchDto[];
  /** Accounts that could be made managers, plus those already assigned. */
  users: { id: number; name: string; email: string; branchId: number | null }[];
  error?: string;
};

/** What the current viewer is allowed to see; drives the branch picker. */
export type ScopeDto = {
  branchId: number;
  branchName: string;
  isOwner: boolean;
  canSwitch: boolean;
  branches: { id: number; name: string }[];
  error?: string;
};

/** Turns a ZodError into the single-string shape the UI already renders. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.message ?? "Некоректні дані";
}
