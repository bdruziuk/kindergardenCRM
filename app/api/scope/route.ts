import type { ScopeDto } from "@/lib/api-schemas";
import { resolveScope, scopeFailure } from "@/lib/scope";

/** What the signed-in viewer may look at. Every page asks this first so it
 *  knows whether to show a branch picker at all. */
export async function GET(request: Request) {
  try {
    const scope = await resolveScope(
      new URL(request.url).searchParams.get("branch"),
    );
    const body: ScopeDto = {
      branchId: scope.branchId,
      branchName: scope.branchName,
      isOwner: scope.isOwner,
      canSwitch: scope.canSwitch,
      branches: scope.branches,
    };
    return Response.json(body);
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
