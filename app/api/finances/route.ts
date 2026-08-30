import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { transactions } from "@/db/schema";
import {
  type FinanceSnapshot,
  type MethodTotals,
  type PaymentMethod,
  firstIssue,
  paymentMethodValues,
  transactionRequest,
} from "@/lib/api-schemas";
import { FALLBACK_MONTH, monthStart } from "@/lib/period";
import {
  childrenWithPayments,
  monthExpenses,
  paymentsSummary,
  salaryProgress,
} from "@/lib/queries";
import { mutatePayout } from "@/lib/payouts";
import { resolveScope, scopeFailure } from "@/lib/scope";

/** The one expense the app derives itself; it cannot be edited by hand. */
const SALARY_CATEGORY = "Зарплата";

async function snapshot(
  branchId: number,
  month: string,
): Promise<FinanceSnapshot> {
  const [childRows, salaryRows, rows] = await Promise.all([
    childrenWithPayments(branchId, month),
    salaryProgress(branchId, month),
    monthExpenses(branchId, month),
  ]);

  // Income is not a ledger of its own: the only money coming in is the
  // monthly fee, so it is whatever the parents have actually paid.
  const income = paymentsSummary(childRows).received;

  // The expense is the cash that actually left, mirroring income being what
  // parents actually paid. What the timesheet accrued is reported alongside.
  const salaryAccrued = salaryRows.reduce((sum, row) => sum + row.accrued, 0);
  const salary = salaryRows.reduce((sum, row) => sum + row.paid, 0);
  const salaryRemaining = Math.round((salaryAccrued - salary) * 100) / 100;
  const other = rows.reduce((sum, row) => sum + row.amount, 0);
  const total = salary + other;

  const byCategory = new Map<string, number>();
  if (salary) byCategory.set(SALARY_CATEGORY, salary);
  for (const row of rows)
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.amount);

  // Розклад по видах оплати. Витрата віднімається саме від доходів свого
  // виду — готівка з готівки, — бо це різні гаманці, і спільний підсумок
  // ховав би те, що на карті грошей уже немає, поки в касі вони ще є.
  const zero = () => ({ income: 0, expense: 0 });
  const perMethod = new Map<PaymentMethod, { income: number; expense: number }>(
    paymentMethodValues.map((method) => [method, zero()]),
  );

  for (const child of childRows)
    for (const item of child.history)
      perMethod.get(item.method)!.income += item.amount;

  for (const row of rows) perMethod.get(row.method)!.expense += row.amount;

  // Зарплата — теж витрата, і теж має вид: без неї підсумок не сходився б
  // саме на найбільшій статті.
  for (const person of salaryRows)
    for (const item of person.payouts)
      perMethod.get(item.method)!.expense += item.amount;

  const methods: MethodTotals[] = paymentMethodValues.map((method) => {
    const totals = perMethod.get(method) ?? zero();
    return {
      method,
      income: Math.round(totals.income * 100) / 100,
      expense: Math.round(totals.expense * 100) / 100,
      balance: Math.round((totals.income - totals.expense) * 100) / 100,
    };
  });

  const categories = [...byCategory.entries()]
    .map(([category, amount]) => ({
      category,
      amount,
      share: total ? Math.round((amount / total) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    month: monthStart(month).slice(0, 7),
    rows,
    salaryRows,
    summary: {
      income,
      expense: { salary, other, total },
      salaryAccrued,
      salaryRemaining,
      balance: Math.round((income - total) * 100) / 100,
    },
    categories,
    methods,
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
    const parsed = transactionRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const db = getDb();
    const body = parsed.data;

    if (body.kind === "add") {
      await db.insert(transactions).values({
        branchId,
        category: body.category,
        amount: body.amount,
        method: body.method,
        occurredAt: body.occurredAt,
        note: body.note || null,
      });
    } else if (body.kind === "remove") {
      // Умова по філії, а не лише по id: чужу витрату не стерти, підставивши
      // її номер руками.
      await db
        .delete(transactions)
        .where(
          and(
            eq(transactions.id, body.transactionId),
            eq(transactions.branchId, branchId),
          ),
        );
    } else {
      // Виплати правляться й тут: список зарплат на цій сторінці той самий,
      // що в «Колективі», тож і дії над ним однакові.
      await mutatePayout(branchId, body);
    }

    return Response.json(await snapshot(branchId, body.month ?? FALLBACK_MONTH));
  } catch (error) {
    return scopeFailure(error) ?? Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}
