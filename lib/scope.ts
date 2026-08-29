import { asc, eq, isNotNull } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { getDb } from "@/db";
import { branches, users } from "@/db/schema";
import { authOptions } from "./auth";

export type BranchRef = { id: number; name: string };

export type Scope = {
  /** The branch every query in this request must be restricted to. */
  branchId: number;
  branchName: string;
  /** The owner sees every branch; a manager only their own. */
  isOwner: boolean;
  /** Branches the viewer may switch between. */
  branches: BranchRef[];
  /** False while there is nothing to choose from — a single branch run by the
   *  owner alone. The UI hides the picker entirely in that case. */
  canSwitch: boolean;
};

export class ScopeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Works out which branch the signed-in user is allowed to look at.
 *
 * A manager is pinned to their own branch and a `branch` parameter from them
 * is refused rather than ignored, so a mistake surfaces instead of quietly
 * showing the wrong data. The owner may switch, but only among branches that
 * actually exist.
 */
export async function resolveScope(requested?: string | null): Promise<Scope> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new ScopeError("Потрібна авторизація", 401);

  const db = getDb();
  const userId = Number(session.user.id);

  const [[viewer], all, managed] = await Promise.all([
    db
      .select({ role: users.role, branchId: users.branchId })
      .from(users)
      .where(eq(users.id, userId)),
    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .orderBy(asc(branches.id)),
    db
      .select({ id: users.id })
      .from(users)
      .where(isNotNull(users.branchId)),
  ]);

  if (!viewer) throw new ScopeError("Користувача не знайдено", 401);
  if (!all.length) throw new ScopeError("Не створено жодної філії", 500);

  const wanted = requested ? Number(requested) : null;
  const isOwner = viewer.role === "admin";

  if (!isOwner) {
    const own = all.find((branch) => branch.id === viewer.branchId);
    if (!own) throw new ScopeError("Вам не призначено філію", 403);
    if (wanted && wanted !== own.id)
      throw new ScopeError("Немає доступу до цієї філії", 403);
    return {
      branchId: own.id,
      branchName: own.name,
      isOwner: false,
      branches: [own],
      canSwitch: false,
    };
  }

  const chosen = all.find((branch) => branch.id === wanted) ?? all[0];
  return {
    branchId: chosen.id,
    branchName: chosen.name,
    isOwner: true,
    branches: all,
    // Nothing to pick while the owner runs a single branch on their own; the
    // picker appears as soon as there is a second branch or a manager.
    canSwitch: all.length > 1 || managed.length > 0,
  };
}

/** Turns a ScopeError into the `{ error }` shape every route already returns. */
export function scopeFailure(error: unknown) {
  if (error instanceof ScopeError)
    return Response.json({ error: error.message }, { status: error.status });
  return null;
}
