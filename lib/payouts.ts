import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { salaryPayments, staff } from "@/db/schema";
import { FALLBACK_MONTH, monthStart } from "./period";
import { ScopeError } from "./scope";

type PayoutAction =
  | {
      kind: "payout_add";
      staffId: number;
      payoutKind: "advance" | "salary";
      amount: number;
      method: "cash" | "iban" | "card";
      paidAt: string;
      note: string;
      month?: string;
    }
  | {
      kind: "payout_update";
      payoutId: number;
      payoutKind: "advance" | "salary";
      amount: number;
      method: "cash" | "iban" | "card";
      paidAt: string;
      note: string;
      month?: string;
    }
  | { kind: "payout_remove"; payoutId: number; month?: string };

/**
 * Виплати правлять і в «Колективі», і в «Доходах і витратах», тож логіка тут
 * одна на обидва маршрути — інакше перевірка доступу неминуче розійшлася б.
 *
 * Виплата не має власної філії: вона належить їй через працівника. Тому кожна
 * дія звіряється саме через нього — інакше чужу виплату можна було б стерти
 * чи переписати, підставивши номер руками.
 */
export async function mutatePayout(branchId: number, body: PayoutAction) {
  const db = getDb();

  const assertStaffInBranch = async (staffId: number) => {
    const [person] = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.id, staffId), eq(staff.branchId, branchId)));
    if (!person) throw new ScopeError("Немає доступу до цього працівника", 403);
  };

  const loadPayout = async (payoutId: number) => {
    const [payout] = await db
      .select({ id: salaryPayments.id, staffId: salaryPayments.staffId })
      .from(salaryPayments)
      .where(eq(salaryPayments.id, payoutId));
    if (!payout) throw new ScopeError("Виплату не знайдено", 404);
    await assertStaffInBranch(payout.staffId);
    return payout;
  };

  if (body.kind === "payout_add") {
    await assertStaffInBranch(body.staffId);
    await db.insert(salaryPayments).values({
      staffId: body.staffId,
      month: monthStart(body.month ?? FALLBACK_MONTH),
      kind: body.payoutKind,
      amount: body.amount,
      method: body.method,
      paidAt: body.paidAt,
      note: body.note || null,
    });
    return;
  }

  const payout = await loadPayout(body.payoutId);

  if (body.kind === "payout_remove") {
    await db.delete(salaryPayments).where(eq(salaryPayments.id, payout.id));
    return;
  }

  // Платіжний місяць не чіпаємо: він визначає, до якого місяця належить
  // виплата, і зміна його тут мовчки перенесла б суму в інший підсумок.
  await db
    .update(salaryPayments)
    .set({
      kind: body.payoutKind,
      amount: body.amount,
      method: body.method,
      paidAt: body.paidAt,
      note: body.note || null,
    })
    .where(eq(salaryPayments.id, payout.id));
}
