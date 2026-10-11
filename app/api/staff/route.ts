import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  groupStaff,
  lessons,
  salaryPayments,
  staff,
  staffAttendance,
  staffDeductions,
} from "@/db/schema";
import { type SalaryType, firstIssue, staffRequest } from "@/lib/api-schemas";
import { currentMonth, monthStart } from "@/lib/period";
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
    const month = params.get("month") ?? currentMonth();
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
    const { branchId, canManageBranch } = await resolveScope(
      new URL(request.url).searchParams.get("branch"),
      { write: true },
    );
    const parsed = staffRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const db = getDb();
    const body = parsed.data;
    const isPayout =
      body.kind === "payout_add" ||
      body.kind === "payout_update" ||
      body.kind === "payout_remove";
    // Виплати мають власні перевірки за датою руху грошей, а не за місяцем
    // сторінки: за закритий місяць роботи платять уже наступного місяця, і
    // спільна перевірка тут забороняла б саме це.
    // Фото не належить місяцю: його можна поміняти, навіть дивлячись на
    // закритий місяць, — у знімок воно однаково не входить.
    const isPhoto = body.kind === "photo_set" || body.kind === "photo_clear";
    if (!isPayout && !isPhoto)
      await assertMonthOpen(branchId, body.month ?? currentMonth());

    // Кожен переданий ID перевіряємо в межах філії до будь-якого запису.
    if (
      body.kind === "attendance" ||
      body.kind === "lesson_add" ||
      body.kind === "update_staff" ||
      body.kind === "deduction_set" ||
      isPhoto
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
    } else if (isPayout) {
      await mutatePayout(branchId, body);
    } else if (isPhoto) {
      if (!canManageBranch)
        throw new ScopeError(
          "Фото працівника змінює власник або керуючий філії",
          403,
        );
      let photo: string | null = null;
      let photoMime: string | null = null;
      if (body.kind === "photo_set") {
        const match = body.dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
        if (!match) throw new ScopeError("Некоректне зображення", 400);
        [, photoMime, photo] = match;
      }
      await db
        .update(staff)
        .set({ photo, photoMime })
        .where(and(eq(staff.id, body.staffId), eq(staff.branchId, branchId)));
    } else if (body.kind === "deduction_set") {
      // Гроші з зарплати — справа того, хто веде філію, а не вихователя.
      // Закритий місяць роботи відсіяно вище: вирахування змінює нараховане,
      // а воно в закритому місяці заморожене.
      if (!canManageBranch)
        throw new ScopeError(
          "Вирахування вносить власник або керуючий філії",
          403,
        );
      const month = monthStart(body.month ?? currentMonth());
      if (body.amount === 0) {
        await db
          .delete(staffDeductions)
          .where(
            and(
              eq(staffDeductions.staffId, body.staffId),
              eq(staffDeductions.month, month),
            ),
          );
      } else {
        await db
          .insert(staffDeductions)
          .values({
            staffId: body.staffId,
            month,
            amount: body.amount,
            note: body.note || null,
          })
          .onConflictDoUpdate({
            target: [staffDeductions.staffId, staffDeductions.month],
            set: { amount: body.amount, note: body.note || null },
          });
      }
    } else if (body.kind === "remove_staff") {
      // Керуючий видаляє лише своїх: resolveScope не пускає його в чужу філію,
      // а працівника нижче шукаємо саме в цій.
      if (!canManageBranch)
        throw new ScopeError(
          "Видаляти працівників може власник або керуючий філії",
          403,
        );
      const staffId = body.staffId;
      await db.transaction(async (tx) => {
        // Рядок блокуємо до перевірки: нова виплата чи відмітка посилається на
        // працівника й чекатиме, тож не проскочить між перевіркою і видаленням.
        const [person] = await tx
          .select({ id: staff.id })
          .from(staff)
          .where(and(eq(staff.id, staffId), eq(staff.branchId, branchId)))
          .for("update");
        if (!person) throw new ScopeError("Працівника не знайдено", 404);

        const [marks, taught, paid] = await Promise.all([
          tx.select({ id: staffAttendance.id }).from(staffAttendance).where(eq(staffAttendance.staffId, staffId)),
          tx.select({ id: lessons.id }).from(lessons).where(eq(lessons.staffId, staffId)),
          tx.select({ id: salaryPayments.id }).from(salaryPayments).where(eq(salaryPayments.staffId, staffId)),
        ]);

        if (!marks.length && !taught.length && !paid.length) {
          // Заведений помилково: ні табеля, ні занять, ні грошей — стирати
          // нічого, крім самого запису.
          await tx.delete(staff).where(eq(staff.id, staffId));
          return;
        }
        // Інакше стерти означало б забрати з каси виплати, а з минулих місяців —
        // відпрацьовані дні. Звільнений лишається там, де в нього є записи
        // (закриті місяці — ще й у знімку), і зникає з решти. Із груп його
        // знімаємо одразу: закріплювати за групою того, хто не працює, нема як.
        await tx.update(staff).set({ active: false }).where(eq(staff.id, staffId));
        await tx.delete(groupStaff).where(eq(groupStaff.staffId, staffId));
      });
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

    return Response.json(await snapshot(branchId, body.month ?? currentMonth()));
  } catch (error) {
    return scopeFailure(error) ?? Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}
