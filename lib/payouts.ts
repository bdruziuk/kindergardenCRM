import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { salaryPayments, staff } from "@/db/schema";
import { currentMonth, monthStart } from "./period";
import { ScopeError } from "./scope";
import { assertMonthOpen, lockFinancialMonth } from "./month-close";

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
      payrollMonth?: string;
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
 *
 * Два різні місяці, дві різні перевірки. Місяць роботи — той, за який платять:
 * він заморожується закриттям разом із табелем і нарахуваннями. Дата виплати —
 * коли гроші справді вийшли: саме її місяць вирішує, чи можна рух грошей ще
 * записувати. Зарплату за закритий вересень виплачують у жовтні, і це
 * нормальна робота садочка, а не спроба переписати минуле — тому закритий
 * місяць роботи виплату не блокує. Блокує лише закритий фінансовий місяць, бо
 * тоді змінювалася б уже здана каса.
 */
export async function mutatePayout(branchId: number, body: PayoutAction) {
  await getDb().transaction(async (tx) => {
    const assertStaffInBranch = async (staffId: number) => {
      const [person] = await tx
        .select({ id: staff.id })
        .from(staff)
        .where(and(eq(staff.id, staffId), eq(staff.branchId, branchId)));
      if (!person) throw new ScopeError("Немає доступу до цього працівника", 403);
    };

    if (body.kind === "payout_add") {
      await assertStaffInBranch(body.staffId);
      // Місяць роботи беремо з окремого поля, а не з місяця сторінки: той лише
      // каже, звідки прийшов запит, і сам по собі нічого не означає.
      const payrollMonth = body.payrollMonth ?? body.month ?? currentMonth();
      const financialMonth = body.paidAt.slice(0, 7);
      await lockFinancialMonth(tx, branchId, financialMonth);
      // Рух грошей — за датою виплати. Місяць роботи тут навмисно не перевіряємо.
      await assertMonthOpen(branchId, financialMonth);
      // Повторний клік або повторно надісланий запит не має створювати другу
      // таку саму виплату: той самий працівник, місяць роботи, вид, сума,
      // спосіб і дата — це одна операція, а не дві.
      const [duplicate] = await tx
        .select({ id: salaryPayments.id })
        .from(salaryPayments)
        .where(
          and(
            eq(salaryPayments.staffId, body.staffId),
            eq(salaryPayments.month, monthStart(payrollMonth)),
            eq(salaryPayments.kind, body.payoutKind),
            eq(salaryPayments.amount, body.amount),
            eq(salaryPayments.method, body.method),
            eq(salaryPayments.paidAt, body.paidAt),
          ),
        );
      if (duplicate) return;
      await tx.insert(salaryPayments).values({
        staffId: body.staffId,
        month: monthStart(payrollMonth),
        kind: body.payoutKind,
        amount: body.amount,
        method: body.method,
        paidAt: body.paidAt,
        note: body.note || null,
      });
      return;
    }

    const [payout] = await tx
      .select({
        id: salaryPayments.id,
        staffId: salaryPayments.staffId,
        month: salaryPayments.month,
        paidAt: salaryPayments.paidAt,
      })
      .from(salaryPayments)
      .where(eq(salaryPayments.id, body.payoutId));
    if (!payout) throw new ScopeError("Виплату не знайдено", 404);
    await assertStaffInBranch(payout.staffId);

    // Звідки рухаємо: фінансовий місяць береться з дати, яка вже в базі, а не з
    // тіла запиту — інакше закритий місяць обходився б підставленим полем.
    const source = payout.paidAt.slice(0, 7);
    await lockFinancialMonth(tx, branchId, source);
    await assertMonthOpen(branchId, source);

    if (body.kind === "payout_remove") {
      await tx.delete(salaryPayments).where(eq(salaryPayments.id, payout.id));
      return;
    }

    // Куди рухаємо: якщо дату виплати переносять, цільовий місяць має бути так
    // само відкритий, інакше витрата з'явилася б у вже зданому періоді.
    const target = body.paidAt.slice(0, 7);
    if (target !== source) {
      await lockFinancialMonth(tx, branchId, target);
      await assertMonthOpen(branchId, target);
    }

    // Місяць роботи не чіпаємо: він визначає, за що ця виплата, і зміна його
    // тут мовчки перенесла б суму в інший борг.
    await tx
      .update(salaryPayments)
      .set({
        kind: body.payoutKind,
        amount: body.amount,
        method: body.method,
        paidAt: body.paidAt,
        note: body.note || null,
      })
      .where(eq(salaryPayments.id, payout.id));
  });
}
