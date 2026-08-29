import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Money is always numeric(12,2) read back as a JS number; dates are `date`
// columns read back as "YYYY-MM-DD" strings, which is what the API emits.
const money = (name: string) =>
  numeric(name, { precision: 12, scale: 2, mode: "number" });
const day = (name: string) => date(name, { mode: "string" });

export const childStatus = pgEnum("child_status", ["active", "paused", "left"]);
export const paymentMethod = pgEnum("payment_method", ["cash", "iban", "card"]);
export const salaryType = pgEnum("salary_type", [
  "monthly",
  "daily",
  "lesson",
]);
export const salaryKind = pgEnum("salary_kind", ["advance", "salary"]);
export const attendanceKind = pgEnum("attendance_kind", [
  "worked",
  "absent",
  "vacation",
  "day_off",
]);
export const waitlistStatus = pgEnum("waitlist_status", [
  "waiting",
  "invited",
  "enrolled",
  "declined",
]);
export const userRole = pgEnum("user_role", ["admin", "manager", "teacher"]);
export const colorTheme = pgEnum("color_theme", [
  "green",
  "blue",
  "red",
  "yellow",
]);

export const branches = pgTable(
  "branches",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    address: text("address"),
    monthlyFee: money("monthly_fee").notNull().default(0),
    /** Схема інтерфейсу для тих, хто працює в цій філії; null — типова. */
    theme: colorTheme("theme"),
    /** Схему поставив власник, тож керуючий її вже не змінює. Прапорець
     *  потрібен саме тому, що за самим `theme` не видно, хто його виставив. */
    themeByOwner: boolean("theme_by_owner").notNull().default(false),
  },
  (t) => [uniqueIndex("idx_branches_name").on(t.name)],
);

export const groups = pgTable(
  "groups",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    ageRange: text("age_range").notNull().default(""),
    icon: text("icon").notNull().default("✦"),
    color: text("color").notNull().default("star"),
  },
  (t) => [uniqueIndex("idx_groups_branch_name").on(t.branchId, t.name)],
);

export const children = pgTable(
  "children",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    groupId: integer("group_id").references(() => groups.id, {
      onDelete: "set null",
    }),
    fullName: text("full_name").notNull(),
    birthDate: day("birth_date"),
    // null means "use the branch monthly fee"
    customFee: money("custom_fee"),
    status: childStatus("status").notNull().default("active"),
    /** Enrolment window. A report for a period counts a child when the two
     *  overlap, so a child who left in May no longer inflates September and a
     *  child who arrived in September does not appear in the spring.
     *  Both are nullable: null means "as far back / as far ahead as we know". */
    enrolledAt: day("enrolled_at"),
    leftAt: day("left_at"),
  },
  (t) => [index("idx_children_branch_group").on(t.branchId, t.groupId)],
);

export const relatives = pgTable(
  "relatives",
  {
    id: serial("id").primaryKey(),
    childId: integer("child_id")
      .notNull()
      .references(() => children.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    relation: text("relation").notNull().default("Родич"),
    phone: text("phone"),
    email: text("email"),
  },
  (t) => [index("idx_relatives_child").on(t.childId)],
);

export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    childId: integer("child_id")
      .notNull()
      .references(() => children.id, { onDelete: "cascade" }),
    // first day of the billing month
    billingMonth: day("billing_month").notNull(),
    amount: money("amount").notNull(),
    method: paymentMethod("method").notNull(),
    paidAt: day("paid_at").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_payments_month_child").on(t.billingMonth, t.childId)],
);

export const staff = pgTable(
  "staff",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    fullName: text("full_name").notNull(),
    role: text("role").notNull(),
    birthDate: day("birth_date"),
    salaryType: salaryType("salary_type").notNull().default("monthly"),
    monthlyRate: money("monthly_rate").notNull().default(0),
    dailyRate: money("daily_rate").notNull().default(0),
    lessonRate: money("lesson_rate").notNull().default(0),
    // Paid vacation is an annual entitlement; paid days off are a monthly one.
    vacationQuota: integer("vacation_quota").notNull().default(0),
    dayOffQuota: integer("day_off_quota").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("idx_staff_branch").on(t.branchId)],
);

export const staffAttendance = pgTable(
  "staff_attendance",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    workDate: day("work_date").notNull(),
    kind: attendanceKind("kind").notNull(),
  },
  (t) => [uniqueIndex("idx_attendance_staff_date").on(t.staffId, t.workDate)],
);

/** One row per lesson taught. A day with three lessons has three rows, so the
 *  optional note belongs to the lesson rather than to the day. */
export const lessons = pgTable(
  "lessons",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    workDate: day("work_date").notNull(),
    note: text("note"),
  },
  (t) => [index("idx_lessons_staff_date").on(t.staffId, t.workDate)],
);

/** Money actually handed to a staff member, as opposed to what the timesheet
 *  accrues. `month` is the payroll month being settled; `paidAt` is when the
 *  cash actually left, so an August salary paid in September counts towards
 *  August payroll but September expenses. */
export const salaryPayments = pgTable(
  "salary_payments",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    month: day("month").notNull(),
    kind: salaryKind("kind").notNull(),
    amount: money("amount").notNull(),
    paidAt: day("paid_at").notNull(),
    note: text("note"),
  },
  (t) => [
    index("idx_salary_payments_staff_month").on(t.staffId, t.month),
    index("idx_salary_payments_paid_at").on(t.paidAt),
  ],
);

/** Hand-entered expenses. Income is never entered by hand: the only money
 *  coming in is the monthly fee, which lives in `payments`. */
export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    category: text("category").notNull(),
    amount: money("amount").notNull(),
    occurredAt: day("occurred_at").notNull(),
    note: text("note"),
  },
  (t) => [index("idx_transactions_branch_date").on(t.branchId, t.occurredAt)],
);

/** Children queued for a place: the child, one contact parent, and what the
 *  family is hoping for — a particular group, a starting month, or both. */
export const waitlist = pgTable(
  "waitlist",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    childName: text("child_name").notNull(),
    childBirthDate: day("child_birth_date"),
    parentName: text("parent_name").notNull(),
    parentPhone: text("parent_phone").notNull(),
    parentEmail: text("parent_email"),
    /** Wished-for group; null means no preference. */
    preferredGroupId: integer("preferred_group_id").references(() => groups.id, {
      onDelete: "set null",
    }),
    /** First day of the month the family wants to start from. */
    desiredFrom: day("desired_from"),
    status: waitlistStatus("status").notNull().default("waiting"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_waitlist_branch_status").on(t.branchId, t.status)],
);

/** Вікові категорії черги. В одну групу садочок бере дітей кількох років
 *  народження, тож категорія задається діапазоном років, а не роком: «Молодша»
 *  може означати 2022–2023. Діапазони не мусять бути суцільними — дитина, чий
 *  рік не потрапив у жодну категорію, показується окремим блоком. */
export const ageCategories = pgTable(
  "age_categories",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Обидва роки включно. */
    fromYear: integer("from_year").notNull(),
    toYear: integer("to_year").notNull(),
  },
  (t) => [uniqueIndex("idx_age_categories_branch_name").on(t.branchId, t.name)],
);

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name"),
    /** `admin` is the owner: sees every branch and creates new ones.
     *  `manager` runs exactly one, named by `branchId` below. */
    role: userRole("role").notNull().default("admin"),
    /** null for the owner — they are not tied to a single branch. */
    branchId: integer("branch_id").references(() => branches.id, {
      onDelete: "set null",
    }),
    /** Особиста схема інтерфейсу власника; null — брати схему філії. */
    theme: colorTheme("theme"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("idx_users_email").on(t.email)],
);
