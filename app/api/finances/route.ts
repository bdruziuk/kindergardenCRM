import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { transactions } from "@/db/schema";
import { firstIssue, transactionRequest } from "@/lib/api-schemas";
import { currentMonth } from "@/lib/period";
import { assertMonthOpen, loadClose } from "@/lib/month-close";
import { mutatePayout } from "@/lib/payouts";
import { financeSnapshot as snapshot } from "@/lib/snapshots";
import { ScopeError, resolveScope, scopeFailure } from "@/lib/scope";


export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const { branchId } = await resolveScope(params.get("branch"));
    const month = params.get("month") ?? currentMonth();
    const closed = await loadClose(branchId, month);
    return Response.json(
      closed
        ? { ...(closed.snapshot.finances as object), closed: true, closedAt: closed.closedAt }
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
    const parsed = transactionRequest.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const db = getDb();
    const body = parsed.data;
    await assertMonthOpen(branchId, body.month ?? currentMonth());

    if (body.kind === "add") {
      await assertMonthOpen(branchId, body.occurredAt.slice(0, 7));
      await db.insert(transactions).values({
        branchId,
        category: body.category,
        amount: body.amount,
        method: body.method,
        occurredAt: body.occurredAt,
        note: body.note || null,
      });
    } else if (body.kind === "remove") {
      const [expense] = await db
        .select({ occurredAt: transactions.occurredAt })
        .from(transactions)
        .where(and(eq(transactions.id, body.transactionId), eq(transactions.branchId, branchId)));
      if (!expense) throw new ScopeError("Витрату не знайдено", 404);
      await assertMonthOpen(branchId, expense.occurredAt.slice(0, 7));
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

    return Response.json(await snapshot(branchId, body.month ?? currentMonth()));
  } catch (error) {
    return scopeFailure(error) ?? Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}
