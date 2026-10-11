import { and, asc, eq, isNotNull } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { getDb } from "@/db";
import { branches, users } from "@/db/schema";
import { authOptions } from "./auth";

export type BranchRef = { id: number; name: string };

export type Scope = {
  /** Хто дивиться — щоб запис міг зберегти, чиїх це рук справа. */
  userId: number;
  /** Садочок, якому належить усе в цьому запиті. Зовнішня межа ізоляції:
   *  філії з інших садочків не потрапляють сюди навіть до власника. */
  kindergartenId: number;
  /** The branch every query in this request must be restricted to. */
  branchId: number;
  branchName: string;
  /** The owner sees every branch; a manager only their own. */
  isOwner: boolean;
  /** Власник або керуючий: ті, хто веде філію, — видаляють працівників,
   *  закривають і відкривають місяць. Вихователь — ні. */
  canManageBranch: boolean;
  /** Режим перегляду: лише дивитися. Сервер відхиляє будь-яку зміну. */
  readOnly: boolean;
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

export const READ_ONLY_MESSAGE =
  "Режим перегляду: ви можете лише дивитися — додавати, змінювати й видаляти не можна";

/**
 * Режим перегляду, поставлений супер-адміністратором. Перевіряється на
 * сервері в кожному маршруті, що змінює дані, а не лише ховається в
 * інтерфейсі: запит можна надіслати й повз кнопку. Прапорець читається з
 * бази на кожен запит, тож вмикання діє одразу, без повторного входу.
 */
export function assertWritable(readOnly: boolean) {
  if (readOnly) throw new ScopeError(READ_ONLY_MESSAGE, 403);
}

/**
 * Works out which branch the signed-in user is allowed to look at.
 *
 * A manager is pinned to their own branch and a `branch` parameter from them
 * is refused rather than ignored, so a mistake surfaces instead of quietly
 * showing the wrong data. The owner may switch, but only among branches that
 * actually exist — і лише в межах свого садочка.
 *
 * Ізоляція садочків тримається тут, а не в кожному маршруті: запит філій уже
 * звужений до `users.kindergarten_id`, тож «усі філії» для власника означає
 * усі його власні, а чужих він не побачить навіть підставивши їхній id.
 */
export async function resolveScope(
  requested?: string | null,
  /** `write: true` — запит щось змінює, і в режимі перегляду його відхиляють. */
  options: { write?: boolean } = {},
): Promise<Scope> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new ScopeError("Потрібна авторизація", 401);

  const db = getDb();
  const userId = Number(session.user.id);

  const [viewer] = await db
    .select({
      role: users.role,
      branchId: users.branchId,
      kindergartenId: users.kindergartenId,
      readOnly: users.readOnly,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!viewer) throw new ScopeError("Користувача не знайдено", 401);
  // Супер-адміністратор стоїть над садочками й у жодному не працює — його
  // місце в кабінеті, а не в операційних розділах.
  if (viewer.role === "superadmin")
    throw new ScopeError("Супер-адміністратор працює в кабінеті", 403);
  if (!viewer.kindergartenId)
    throw new ScopeError("Вам не призначено садочок", 403);
  if (options.write) assertWritable(viewer.readOnly);

  const kindergartenId = viewer.kindergartenId;

  const [all, managed] = await Promise.all([
    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.kindergartenId, kindergartenId))
      .orderBy(asc(branches.id)),
    db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          isNotNull(users.branchId),
          eq(users.kindergartenId, kindergartenId),
        ),
      ),
  ]);

  // Не помилка сервера, а стан щойно зареєстрованого садочка: власнику треба
  // сказати, що робити далі, а не показати 500.
  if (!all.length)
    throw new ScopeError(
      "У садочку ще немає жодної філії — створіть її в розділі «Філії»",
      409,
    );

  const wanted = requested ? Number(requested) : null;
  const isOwner = viewer.role === "admin";

  if (!isOwner) {
    const own = all.find((branch) => branch.id === viewer.branchId);
    if (!own) throw new ScopeError("Вам не призначено філію", 403);
    if (wanted && wanted !== own.id)
      throw new ScopeError("Немає доступу до цієї філії", 403);
    return {
      kindergartenId,
      branchId: own.id,
      userId,
      branchName: own.name,
      isOwner: false,
      canManageBranch: viewer.role === "manager",
      readOnly: viewer.readOnly,
      branches: [own],
      canSwitch: false,
    };
  }

  const chosen = all.find((branch) => branch.id === wanted) ?? all[0];
  return {
    userId,
    kindergartenId,
    branchId: chosen.id,
    branchName: chosen.name,
    isOwner: true,
    canManageBranch: true,
    readOnly: viewer.readOnly,
    branches: all,
    // Nothing to pick while the owner runs a single branch on their own; the
    // picker appears as soon as there is a second branch or a manager.
    canSwitch: all.length > 1 || managed.length > 0,
  };
}

/**
 * Власник і його садочок — **без** вимоги, щоб філія вже існувала.
 *
 * Потрібно сторінці «Філії»: саме там створюють першу філію, тож вимагати
 * наявну означало б замкнене коло — щойно зареєстрований садочок неможливо
 * було б почати наповнювати.
 */
export async function resolveOwner(
  /** Як у `resolveScope`: зміна в режимі перегляду відхиляється. */
  options: { write?: boolean } = {},
): Promise<{
  userId: number;
  kindergartenId: number;
}> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new ScopeError("Потрібна авторизація", 401);

  const userId = Number(session.user.id);
  const [viewer] = await getDb()
    .select({
      role: users.role,
      kindergartenId: users.kindergartenId,
      readOnly: users.readOnly,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!viewer) throw new ScopeError("Користувача не знайдено", 401);
  if (viewer.role !== "admin")
    throw new ScopeError("Доступно лише власнику", 403);
  if (!viewer.kindergartenId)
    throw new ScopeError("Вам не призначено садочок", 403);
  if (options.write) assertWritable(viewer.readOnly);

  return { userId, kindergartenId: viewer.kindergartenId };
}

/** Turns a ScopeError into the `{ error }` shape every route already returns. */
export function scopeFailure(error: unknown) {
  if (error instanceof ScopeError)
    return Response.json({ error: error.message }, { status: error.status });
  return null;
}
