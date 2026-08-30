import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { MONTH, firstIssue, monthCloseRequest } from "@/lib/api-schemas";
import { authOptions } from "@/lib/auth";
import { closeMonth, loadClose, openMonth } from "@/lib/month-close";
import { FALLBACK_MONTH } from "@/lib/period";
import { ScopeError, resolveScope, scopeFailure } from "@/lib/scope";
import {
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
    const month = raw && MONTH.test(raw) ? raw : FALLBACK_MONTH;

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
    const { branchId } = await resolveScope(
      new URL(request.url).searchParams.get("branch"),
    );
    const parsed = monthCloseRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const session = await getServerSession(authOptions);
    const userId = Number(session?.user?.id);
    const [viewer] = await getDb()
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId));
    if (!viewer) throw new ScopeError("Користувача не знайдено", 401);

    const { month, action } = parsed.data;

    if (action === "close") {
      // Закривають обидва: керуючий бачить, коли по його філії все внесено.
      const [payments, staff, finances] = await Promise.all([
        paymentsSnapshot(branchId, month),
        staffSnapshot(branchId, month),
        financeSnapshot(branchId, month),
      ]);
      await closeMonth(branchId, month, userId, { payments, staff, finances });
    } else {
      // Відкриває лише власник: інакше «закрито» не означало б нічого — той,
      // хто закрив, тим самим рухом і відкрив би назад.
      if (viewer.role !== "admin")
        throw new ScopeError("Відкрити місяць може лише власник", 403);
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
