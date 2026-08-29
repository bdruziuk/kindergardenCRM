import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  jobTitles,
  lessons,
  salaryPayments,
  staff,
  staffAttendance,
} from "@/db/schema";
import { type SalaryType, firstIssue, staffRequest } from "@/lib/api-schemas";
import { FALLBACK_MONTH, monthStart } from "@/lib/period";
import { staffWithAttendance } from "@/lib/queries";
import { resolveScope, scopeFailure } from "@/lib/scope";

type RateFields = {
  salaryType: SalaryType;
  monthlyRate: number;
  dailyRate: number;
  lessonRate: number;
  vacationQuota: number;
  dayOffQuota: number;
};

const rateValues = (body: RateFields): RateFields => ({
  salaryType: body.salaryType,
  monthlyRate: body.monthlyRate,
  dailyRate: body.dailyRate,
  lessonRate: body.lessonRate,
  vacationQuota: body.vacationQuota,
  dayOffQuota: body.dayOffQuota,
});

async function snapshot(branchId: number, month: string) {
  const { info, rows } = await staffWithAttendance(branchId, month);
  // Посади філії — вони наповнюють випадайку замість колишнього списку,
  // зашитого в сторінку.
  const titles = await getDb()
    .select({
      id: jobTitles.id,
      name: jobTitles.name,
      addedByOwner: jobTitles.addedByOwner,
      salaryType: jobTitles.salaryType,
      rate: jobTitles.rate,
      vacationQuota: jobTitles.vacationQuota,
      dayOffQuota: jobTitles.dayOffQuota,
    })
    .from(jobTitles)
    .where(eq(jobTitles.branchId, branchId))
    .orderBy(asc(jobTitles.id));
  // Lesson-paid staff may still carry attendance rows from before they were
  // switched over, but their pay ignores those and the grid shows lessons in
  // their cells — so counting them here would show days nobody can see.
  const onAttendance = rows.filter((row) => row.salaryType !== "lesson");
  return {
    ...info,
    jobTitles: titles,
    rows,
    summary: {
      staffCount: rows.length,
      workedDays: onAttendance.reduce((sum, row) => sum + row.workedDays, 0),
      absentDays: onAttendance.reduce((sum, row) => sum + row.absentDays, 0),
      vacationDays: onAttendance.reduce((sum, row) => sum + row.vacationDays, 0),
      dayOffDays: onAttendance.reduce((sum, row) => sum + row.dayOffDays, 0),
      lessonCount: rows.reduce((sum, row) => sum + row.lessonCount, 0),
      salaryTotal: rows.reduce((sum, row) => sum + row.salary, 0),
      paidOutTotal: rows.reduce((sum, row) => sum + row.paidOut.total, 0),
    },
  };
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const { branchId } = await resolveScope(params.get("branch"));
    const month = params.get("month") ?? FALLBACK_MONTH;
    return Response.json(await snapshot(branchId, month));
  } catch (error) {
    return scopeFailure(error) ?? Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { branchId } = await resolveScope(
      new URL(request.url).searchParams.get("branch"),
    );
    const parsed = staffRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const db = getDb();
    const body = parsed.data;

    if (body.kind === "attendance") {
      if (body.state === "unmarked") {
        await db
          .delete(staffAttendance)
          .where(
            and(
              eq(staffAttendance.staffId, body.staffId),
              eq(staffAttendance.workDate, body.date),
            ),
          );
      } else {
        const kind = body.state;
        await db
          .insert(staffAttendance)
          .values({ staffId: body.staffId, workDate: body.date, kind })
          .onConflictDoUpdate({
            target: [staffAttendance.staffId, staffAttendance.workDate],
            set: { kind },
          });
      }
    } else if (body.kind === "lesson_add") {
      await db
        .insert(lessons)
        .values({
          staffId: body.staffId,
          workDate: body.date,
          note: body.note || null,
        });
    } else if (body.kind === "lesson_note") {
      await db
        .update(lessons)
        .set({ note: body.note || null })
        .where(eq(lessons.id, body.lessonId));
    } else if (body.kind === "lesson_remove") {
      await db.delete(lessons).where(eq(lessons.id, body.lessonId));
    } else if (body.kind === "payout_add") {
      await db.insert(salaryPayments).values({
        staffId: body.staffId,
        month: monthStart(body.month ?? FALLBACK_MONTH),
        kind: body.payoutKind,
        amount: body.amount,
        paidAt: body.paidAt,
        note: body.note || null,
      });
    } else if (body.kind === "payout_remove") {
      await db
        .delete(salaryPayments)
        .where(eq(salaryPayments.id, body.payoutId));
    } else if (body.kind === "update_staff") {
      await db
        .update(staff)
        .set({
          fullName: body.name,
          role: body.role,
          birthDate: body.birthDate,
          ...rateValues(body),
        })
        .where(eq(staff.id, body.staffId));
    } else {
      await db.insert(staff).values({
        branchId,
        fullName: body.name,
        role: body.role,
        birthDate: body.birthDate,
        ...rateValues(body),
      });
    }

    return Response.json(await snapshot(branchId, body.month ?? FALLBACK_MONTH));
  } catch (error) {
    return scopeFailure(error) ?? Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}
