import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  branches,
  children,
  groups,
  lessons,
  payments,
  staff,
  salaryPayments,
  staffAttendance,
  transactions,
} from "@/db/schema";
import type {
  AttendanceKind,
  BirthdayDto,
  ChildPaymentsDto,
  ExpenseDto,
  SalaryRowDto,
  StaffRowDto,
} from "./api-schemas";
import { type MonthInfo, monthInfo, monthStart } from "./period";
import { initialsOf } from "./format";

export async function branchFee(branchId: number) {
  const [branch] = await getDb()
    .select({ monthlyFee: branches.monthlyFee })
    .from(branches)
    .where(eq(branches.id, branchId));
  return branch?.monthlyFee ?? 0;
}

/** One row per enrolled child, with the month's payments folded in. */
export async function childrenWithPayments(
  branchId: number,
  month: string,
): Promise<ChildPaymentsDto[]> {
  const db = getDb();
  const billingMonth = monthStart(month);
  const [defaultFee, childRows, paymentRows] = await Promise.all([
    branchFee(branchId),
    db
      .select({
        id: children.id,
        fullName: children.fullName,
        customFee: children.customFee,
        groupName: groups.name,
      })
      .from(children)
      .leftJoin(groups, eq(groups.id, children.groupId))
      .where(and(eq(children.branchId, branchId), ne(children.status, "left")))
      .orderBy(asc(children.fullName)),
    db
      .select()
      .from(payments)
      .where(eq(payments.billingMonth, billingMonth))
      .orderBy(desc(payments.paidAt), desc(payments.id)),
  ]);

  return childRows.map((child) => {
    const history = paymentRows
      .filter((payment) => payment.childId === child.id)
      .map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        method: payment.method,
        paidAt: payment.paidAt,
      }));
    const fee = child.customFee ?? defaultFee;
    const paid = history.reduce((sum, payment) => sum + payment.amount, 0);
    return {
      id: child.id,
      name: child.fullName,
      initials: initialsOf(child.fullName),
      group: child.groupName ?? "",
      fee,
      paid,
      balance: Math.max(fee - paid, 0),
      status: (paid <= 0
        ? "Не сплачено"
        : paid < fee
          ? "Частково"
          : "Сплачено") as ChildPaymentsDto["status"],
      history,
    };
  });
}

export function paymentsSummary(rows: ChildPaymentsDto[]) {
  const planned = rows.reduce((sum, row) => sum + row.fee, 0);
  const received = rows.reduce((sum, row) => sum + row.paid, 0);
  return {
    planned,
    received,
    balance: Math.max(planned - received, 0),
    progress: planned ? Math.round((received / planned) * 100) : 0,
    paidCount: rows.filter((row) => row.status === "Сплачено").length,
    partialCount: rows.filter((row) => row.status === "Частково").length,
    unpaidCount: rows.filter((row) => row.status === "Не сплачено").length,
  };
}

/** Active staff with the month's attendance and the salary it accrues. */
export async function staffWithAttendance(
  branchId: number,
  month: string,
): Promise<{ info: MonthInfo; rows: StaffRowDto[] }> {
  const db = getDb();
  const info = monthInfo(month);
  const firstDay = `${info.month}-01`;

  const [staffRows, attendanceRows, lessonRows, yearLeave, payoutRows] =
    await Promise.all([
    db
      .select({
        id: staff.id,
        fullName: staff.fullName,
        role: staff.role,
        birthDate: staff.birthDate,
        branchName: branches.name,
        salaryType: staff.salaryType,
        monthlyRate: staff.monthlyRate,
        dailyRate: staff.dailyRate,
        lessonRate: staff.lessonRate,
        vacationQuota: staff.vacationQuota,
        dayOffQuota: staff.dayOffQuota,
      })
      .from(staff)
      .leftJoin(branches, eq(branches.id, staff.branchId))
      .where(and(eq(staff.branchId, branchId), eq(staff.active, true)))
      .orderBy(asc(staff.id)),
    db
      .select()
      .from(staffAttendance)
      .where(
        sql`${staffAttendance.workDate} >= ${firstDay}::date
            and ${staffAttendance.workDate} < (${firstDay}::date + interval '1 month')`,
      )
      .orderBy(asc(staffAttendance.workDate)),
    db
      .select()
      .from(lessons)
      .where(
        sql`${lessons.workDate} >= ${firstDay}::date
            and ${lessons.workDate} < (${firstDay}::date + interval '1 month')`,
      )
      .orderBy(asc(lessons.workDate), asc(lessons.id)),
    db
      .select({
        staffId: staffAttendance.staffId,
        kind: staffAttendance.kind,
      })
      .from(staffAttendance)
      .where(
        sql`date_part('year', ${staffAttendance.workDate}) = date_part('year', ${firstDay}::date)
            and ${staffAttendance.kind} = 'vacation'`,
      ),
    db
      .select()
      .from(salaryPayments)
      .where(eq(salaryPayments.month, firstDay))
      .orderBy(asc(salaryPayments.paidAt), asc(salaryPayments.id)),
  ]);

  const rows = staffRows.map((person) => {
    const marks = Object.fromEntries(
      attendanceRows
        .filter((item) => item.staffId === person.id)
        .map((item) => [item.workDate, item.kind]),
    ) as StaffRowDto["marks"];
    const values = Object.values(marks);
    const countOf = (kind: AttendanceKind) =>
      values.filter((value) => value === kind).length;
    const workedDays = countOf("worked");
    const absentDays = countOf("absent");
    const vacationDays = countOf("vacation");
    const dayOffDays = countOf("day_off");
    // Paid leave is paid as if worked, so it feeds the monthly and daily rates.
    const paidDays = workedDays + vacationDays + dayOffDays;

    // Vacation is an annual entitlement, so its usage spans the whole year;
    // paid days off reset every month, so `dayOffDays` already is their usage.
    const vacationUsedYear = yearLeave.filter(
      (row) => row.staffId === person.id,
    ).length;

    const personLessons: StaffRowDto["lessons"] = {};
    for (const lesson of lessonRows) {
      if (lesson.staffId !== person.id) continue;
      (personLessons[lesson.workDate] ??= []).push({
        id: lesson.id,
        note: lesson.note ?? "",
      });
    }
    const lessonCount = Object.values(personLessons).reduce(
      (sum, day) => sum + day.length,
      0,
    );

    const salary =
      person.salaryType === "monthly"
        ? Math.round((person.monthlyRate / info.workdays) * paidDays * 100) / 100
        : person.salaryType === "lesson"
          ? Math.round(person.lessonRate * lessonCount * 100) / 100
          : person.dailyRate * paidDays;

    const payouts = payoutRows
      .filter((row) => row.staffId === person.id)
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        amount: row.amount,
        paidAt: row.paidAt,
        note: row.note ?? "",
      }));
    const sumKind = (kind: "advance" | "salary") =>
      payouts
        .filter((row) => row.kind === kind)
        .reduce((sum, row) => sum + row.amount, 0);
    const paidOut = {
      advance: sumKind("advance"),
      salary: sumKind("salary"),
      total: payouts.reduce((sum, row) => sum + row.amount, 0),
    };

    return {
      id: person.id,
      name: person.fullName,
      role: person.role,
      birthDate: person.birthDate,
      branch: person.branchName ?? "",
      salaryType: person.salaryType,
      monthlyRate: person.monthlyRate,
      dailyRate: person.dailyRate,
      lessonRate: person.lessonRate,
      vacationQuota: person.vacationQuota,
      dayOffQuota: person.dayOffQuota,
      workedDays,
      absentDays,
      vacationDays,
      dayOffDays,
      paidDays,
      vacationUsedYear,
      lessons: personLessons,
      lessonCount,
      salary,
      payouts,
      paidOut,
      remaining: Math.round((salary - paidOut.total) * 100) / 100,
      marks,
    };
  });

  return { info, rows };
}

/** Hand-entered expenses for the month, newest first. */
export async function monthExpenses(
  branchId: number,
  month: string,
): Promise<ExpenseDto[]> {
  const firstDay = monthStart(month);
  const rows = await getDb()
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.branchId, branchId),
        sql`${transactions.occurredAt} >= ${firstDay}::date
            and ${transactions.occurredAt} < (${firstDay}::date + interval '1 month')`,
      ),
    )
    .orderBy(desc(transactions.occurredAt), desc(transactions.id));

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    amount: row.amount,
    occurredAt: row.occurredAt,
    note: row.note ?? "",
  }));
}

/** Salary rows for a payroll month: what each person earned and how much of
 *  it has been handed over. Grouped by the month being settled, not by when
 *  the cash left, so this page never contradicts the staff timesheet. */
export async function salaryProgress(
  branchId: number,
  month: string,
): Promise<SalaryRowDto[]> {
  const { rows } = await staffWithAttendance(branchId, month);
  return rows
    .map((person) => ({
      id: person.id,
      name: person.name,
      role: person.role,
      accrued: person.salary,
      paid: person.paidOut.total,
      remaining: person.remaining,
      progress: person.salary
        ? Math.min(100, Math.round((person.paidOut.total / person.salary) * 100))
        : person.paidOut.total > 0
          ? 100
          : 0,
    }))
    .sort((a, b) => b.remaining - a.remaining);
}

/** Birthdays falling today or within the next `days` days, children and staff
 *  together. Anchored to the server's date rather than the selected month,
 *  because "upcoming" only ever means upcoming from now. */
export async function upcomingBirthdays(
  branchId: number,
  days = 3,
): Promise<BirthdayDto[]> {
  const db = getDb();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Formatted from local parts, not toISOString: east of UTC the latter turns
  // local midnight into the previous day and shifts the whole window.
  const localIso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate(),
    ).padStart(2, "0")}`;

  // Build the window explicitly so a turn of the year or month needs no
  // special case: each target is just a concrete date.
  const window = Array.from({ length: days + 1 }, (_, offset) => {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    const iso = localIso(date);
    return { offset, date, iso, key: iso.slice(5) };
  });
  const keys = window.map((item) => item.key);

  const [childRows, staffRows] = await Promise.all([
    db
      .select({
        id: children.id,
        name: children.fullName,
        birthDate: children.birthDate,
        detail: groups.name,
      })
      .from(children)
      .leftJoin(groups, eq(groups.id, children.groupId))
      .where(
        and(
          eq(children.branchId, branchId),
          ne(children.status, "left"),
          inArray(sql`to_char(${children.birthDate}, 'MM-DD')`, keys),
        ),
      ),
    db
      .select({
        id: staff.id,
        name: staff.fullName,
        birthDate: staff.birthDate,
        detail: staff.role,
      })
      .from(staff)
      .where(
        and(
          eq(staff.branchId, branchId),
          eq(staff.active, true),
          inArray(sql`to_char(${staff.birthDate}, 'MM-DD')`, keys),
        ),
      ),
  ]);

  const build = (
    kind: BirthdayDto["kind"],
    rows: { id: number; name: string; birthDate: string | null; detail: string | null }[],
  ): BirthdayDto[] =>
    rows.flatMap((row) => {
      if (!row.birthDate) return [];
      const slot = window.find(
        (item) => item.key === row.birthDate!.slice(5, 10),
      );
      if (!slot) return [];
      const bornYear = Number(row.birthDate.slice(0, 4));
      const turning = slot.date.getFullYear() - bornYear;
      return [
        {
          kind,
          id: row.id,
          name: row.name,
          date: slot.iso,
          daysAway: slot.offset,
          turning: Number.isFinite(turning) && turning > 0 ? turning : null,
          detail: row.detail ?? "",
        },
      ];
    });

  return [...build("child", childRows), ...build("staff", staffRows)].sort(
    (a, b) => a.daysAway - b.daysAway || a.name.localeCompare(b.name, "uk"),
  );
}
