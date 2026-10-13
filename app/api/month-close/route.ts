import {
  MONTH,
  firstIssue,
  monthCloseRequest,
  type MonthCloseCheck,
} from "@/lib/api-schemas";
import { closeMonth, loadClose, openMonth } from "@/lib/month-close";
import { sumMoney } from "@/lib/money";
import { currentMonth } from "@/lib/period";
import { ScopeError, resolveScope, scopeFailure } from "@/lib/scope";
import {
  dashboardSnapshot,
  financeSnapshot,
  paymentsSnapshot,
  staffSnapshot,
} from "@/lib/snapshots";

/**
 * Перевірка перед закриттям: хто з батьків ще винен, кому не довидали
 * зарплату за цей місяць і що в касі. Рахується тими ж знімками, що закриття
 * збереже, — тож людина бачить рівно те, що буде заморожено.
 */
async function closeCheck(branchId: number, month: string): Promise<MonthCloseCheck> {
  const [payments, finances] = await Promise.all([
    paymentsSnapshot(branchId, month),
    financeSnapshot(branchId, month),
  ]);
  const unpaid = payments.rows
    .filter((row) => row.balance > 0)
    .map((row) => ({ id: row.id, name: row.name, group: row.group, balance: row.balance }))
    .sort((a, b) => b.balance - a.balance);
  const salary = finances.salaryRows
    .filter((row) => row.remaining > 0)
    .map((row) => ({ id: row.id, name: row.name, remaining: row.remaining }));
  return {
    month,
    unpaid: {
      count: unpaid.length,
      total: sumMoney(unpaid, (row) => row.balance),
      rows: unpaid,
    },
    salary: {
      count: salary.length,
      total: sumMoney(salary, (row) => row.remaining),
      rows: salary,
    },
    methods: finances.methods,
  };
}

/** Стан місяця для банера на сторінках; з `check=1` — перевірка перед закриттям. */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const { branchId } = await resolveScope(params.get("branch"));
    const raw = params.get("month");
    const month = raw && MONTH.test(raw) ? raw : currentMonth();
    if (params.get("check") === "1")
      return Response.json(await closeCheck(branchId, month));

    const closed = await loadClose(branchId, month);
    return Response.json({
      month,
      closed: Boolean(closed),
      closedAt: closed?.closedAt ?? null,
    });
  } catch (error) {
    return (
      scopeFailure(error) ??
      Response.json(
        { error: error instanceof Error ? error.message : "PostgreSQL error" },
        { status: 500 },
      )
    );
  }
}

export async function POST(request: Request) {
  try {
    const { branchId, userId, canManageBranch } = await resolveScope(
      new URL(request.url).searchParams.get("branch"),
      { write: true },
    );
    const parsed = monthCloseRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    // Закриває й відкриває той, хто веде філію: власник — будь-яку, керуючий —
    // свою (resolveScope до чужої його не пустить). Вихователь лише бачить стан.
    if (!canManageBranch)
      throw new ScopeError(
        "Закривати й відкривати місяць може власник або керуючий філії",
        403,
      );

    const { month, action } = parsed.data;

    if (action === "close") {
      const [payments, staff, finances, dashboard] = await Promise.all([
        paymentsSnapshot(branchId, month),
        staffSnapshot(branchId, month),
        financeSnapshot(branchId, month),
        dashboardSnapshot(branchId, month),
      ]);
      await closeMonth(branchId, month, userId, {
        payments,
        staff,
        finances,
        dashboard,
      });
    } else {
      await openMonth(branchId, month);
    }

    const closed = await loadClose(branchId, month);
    return Response.json({
      month,
      closed: Boolean(closed),
      closedAt: closed?.closedAt ?? null,
    });
  } catch (error) {
    return (
      scopeFailure(error) ??
      Response.json(
        { error: error instanceof Error ? error.message : "PostgreSQL error" },
        { status: 500 },
      )
    );
  }
}
