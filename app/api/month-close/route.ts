import { MONTH, firstIssue, monthCloseRequest } from "@/lib/api-schemas";
import { closeMonth, loadClose, openMonth } from "@/lib/month-close";
import { currentMonth } from "@/lib/period";
import { ScopeError, resolveScope, scopeFailure } from "@/lib/scope";
import {
  dashboardSnapshot,
  financeSnapshot,
  paymentsSnapshot,
  staffSnapshot,
} from "@/lib/snapshots";

/** Стан місяця для банера на сторінках. */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const { branchId } = await resolveScope(params.get("branch"));
    const raw = params.get("month");
    const month = raw && MONTH.test(raw) ? raw : currentMonth();

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
