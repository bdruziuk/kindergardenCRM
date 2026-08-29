import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { children, payments } from "@/db/schema";
import { firstIssue, paymentRequest } from "@/lib/api-schemas";
import { FALLBACK_MONTH, monthStart } from "@/lib/period";
import { childrenWithPayments, paymentsSummary } from "@/lib/queries";
import { ScopeError, resolveScope, scopeFailure } from "@/lib/scope";

async function snapshot(branchId: number, month: string) {
  const rows = await childrenWithPayments(branchId, month);
  return {
    month: monthStart(month).slice(0, 7),
    rows,
    summary: paymentsSummary(rows),
  };
}

/**
 * Оплати не мають власної філії — вони належать їй через дитину, тож і додавання,
 * і видалення звіряються саме через неї. Без цього чужу дитину можна було б
 * оплатити, а чужу оплату стерти, підставивши номер руками.
 */
async function assertChildInBranch(childId: number, branchId: number) {
  const [child] = await getDb()
    .select({ id: children.id })
    .from(children)
    .where(and(eq(children.id, childId), eq(children.branchId, branchId)));
  if (!child) throw new ScopeError("Немає доступу до цієї дитини", 403);
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
    const parsed = paymentRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const db = getDb();
    const body = parsed.data;

    if (body.kind === "add") {
      await assertChildInBranch(body.childId, branchId);
      await db.insert(payments).values({
        childId: body.childId,
        billingMonth: monthStart(body.month),
        amount: body.amount,
        method: body.method,
        paidAt: body.paidAt ?? new Date().toISOString().slice(0, 10),
      });
    } else {
      const [payment] = await db
        .select({ childId: payments.childId })
        .from(payments)
        .where(eq(payments.id, body.paymentId));
      if (!payment)
        throw new ScopeError("Оплату не знайдено", 404);

      await assertChildInBranch(payment.childId, branchId);
      await db.delete(payments).where(eq(payments.id, body.paymentId));
    }

    return Response.json(await snapshot(branchId, body.month));
  } catch (error) {
    return scopeFailure(error) ?? Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}
