import { FALLBACK_MONTH } from "@/lib/period";
import { upcomingBirthdays } from "@/lib/queries";
import { loadClose } from "@/lib/month-close";
import { resolveScope, scopeFailure } from "@/lib/scope";
import { dashboardSnapshot as snapshot } from "@/lib/snapshots";

export type DashboardDto = Awaited<ReturnType<typeof snapshot>> & {
  closed?: boolean;
  closedAt?: string | null;
};


export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const { branchId } = await resolveScope(params.get("branch"));
    const month = params.get("month") ?? FALLBACK_MONTH;

    const closed = await loadClose(branchId, month);
    if (closed?.snapshot.dashboard)
      return Response.json({
        ...(closed.snapshot.dashboard as object),
        // Дні народження навмисно живі: вони рахуються від сьогодні, а не від
        // місяця, і заморожений список показував би, кого вітали тоді.
        birthdays: await upcomingBirthdays(branchId, 3),
        closed: true,
        closedAt: closed.closedAt,
      });

    return Response.json({
      ...(await snapshot(branchId, month)),
      closed: Boolean(closed),
      closedAt: closed?.closedAt ?? null,
    });
  } catch (error) {
    return scopeFailure(error) ?? Response.json(
      { error: error instanceof Error ? error.message : "PostgreSQL error" },
      { status: 500 },
    );
  }
}
