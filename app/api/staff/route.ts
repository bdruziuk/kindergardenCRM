import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { lessons, staff, staffAttendance } from "@/db/schema";
import { type SalaryType, firstIssue, staffRequest } from "@/lib/api-schemas";
import { FALLBACK_MONTH } from "@/lib/period";
import { assertMonthOpen, loadClose } from "@/lib/month-close";
import { mutatePayout } from "@/lib/payouts";
import { staffSnapshot as snapshot } from "@/lib/snapshots";
import { ScopeError, resolveScope, scopeFailure } from "@/lib/scope";

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


export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const { branchId } = await resolveScope(params.get("branch"));
    const month = params.get("month") ?? FALLBACK_MONTH;
    const closed = await loadClose(branchId, month);
    // Закритий місяць — зі знімка: ставки й склад колективу відтоді змінилися,
    // і перерахунок показав би не ту зарплату, яку тоді нарахували.
    return Response.json(
      closed
        ? { ...(closed.snapshot.staff as object), closed: true, closedAt: closed.closedAt }
        : { ...(await snapshot(branchId, month)), closed: false, closedAt: null },
    );
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
    await assertMonthOpen(branchId, body.month ?? FALLBACK_MONTH);

    // Кожен переданий ID перевіряємо в межах філії до будь-якого запису.
    if (
      body.kind === "attendance" ||
      body.kind === "lesson_add" ||
      body.kind === "update_staff"
    ) {
      const [person] = await db
        .select({ id: staff.id })
        .from(staff)
        .where(and(eq(staff.id, body.staffId), eq(staff.branchId, branchId)));
      if (!person) throw new ScopeError("Працівника не знайдено", 404);
    } else if (body.kind === "lesson_note" || body.kind === "lesson_remove") {
      const [lesson] = await db
        .select({ id: lessons.id, workDate: lessons.workDate })
        .from(lessons)
        .innerJoin(staff, eq(staff.id, lessons.staffId))
        .where(and(eq(lessons.id, body.lessonId), eq(staff.branchId, branchId)));
      if (!lesson) throw new ScopeError("Заняття не знайдено", 404);
      await assertMonthOpen(branchId, lesson.workDate.slice(0, 7));
    }

    if (body.kind === "attendance") {
      await assertMonthOpen(branchId, body.date.slice(0, 7));
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
      await assertMonthOpen(branchId, body.date.slice(0, 7));
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
    } else if (
      body.kind === "payout_add" ||
      body.kind === "payout_update" ||
      body.kind === "payout_remove"
    ) {
      await mutatePayout(branchId, body);
    } else if (body.kind === "update_staff") {
      await db
        .update(staff)
        .set({
          fullName: body.name,
          role: body.role,
          phone: body.phone || null,
          birthDate: body.birthDate,
          ...rateValues(body),
        })
        .where(and(eq(staff.id, body.staffId), eq(staff.branchId, branchId)));
    } else {
      await db.insert(staff).values({
        branchId,
        fullName: body.name,
        role: body.role,
        phone: body.phone || null,
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
