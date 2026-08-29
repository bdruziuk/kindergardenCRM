import { getDb } from "@/db";
import { payments } from "@/db/schema";
import { firstIssue, paymentRequest } from "@/lib/api-schemas";
import { FALLBACK_MONTH, monthStart } from "@/lib/period";
import { childrenWithPayments, paymentsSummary } from "@/lib/queries";
import { resolveScope, scopeFailure } from "@/lib/scope";

async function snapshot(branchId: number, month: string) {
  const rows = await childrenWithPayments(branchId, month);
  return {
    month: monthStart(month).slice(0, 7),
    rows,
    summary: paymentsSummary(rows),
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
    const parsed = paymentRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const body = parsed.data;
    await getDb()
      .insert(payments)
      .values({
        childId: body.childId,
        billingMonth: monthStart(body.month),
        amount: body.amount,
        method: body.method,
        paidAt: body.paidAt ?? new Date().toISOString().slice(0, 10),
      });

    return Response.json(await snapshot(branchId, body.month));
  } catch (error) {
    return scopeFailure(error) ?? Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}
