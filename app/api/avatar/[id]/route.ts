import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { authOptions } from "@/lib/auth";

/**
 * Аватарка користувача картинкою, а не рядком у JSON.
 *
 * Data-URL мандрував би в кожній відповіді API й точно не вліз би в куку
 * сесії, тож сайдбар просто ставить `<img src="/api/avatar/{id}">` — маючи
 * лише id, який у сесії вже є, — і покладається на кеш браузера.
 *
 * Видно її не всім: своя, колеги по садочку або будь-яка для
 * супер-адміністратора. Інакше знімок людини витягувався б перебором id.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return new Response(null, { status: 401 });

    const wanted = Number((await params).id);
    if (!Number.isInteger(wanted) || wanted <= 0)
      return new Response(null, { status: 404 });

    const db = getDb();
    const [[viewer], [target]] = await Promise.all([
      db
        .select({ role: users.role, kindergartenId: users.kindergartenId })
        .from(users)
        .where(eq(users.id, Number(session.user.id))),
      db
        .select({
          avatar: users.avatar,
          avatarMime: users.avatarMime,
          kindergartenId: users.kindergartenId,
        })
        .from(users)
        .where(eq(users.id, wanted)),
    ]);

    if (!viewer || !target?.avatar || !target.avatarMime)
      return new Response(null, { status: 404 });

    const allowed =
      viewer.role === "superadmin" ||
      wanted === Number(session.user.id) ||
      (viewer.kindergartenId !== null &&
        viewer.kindergartenId === target.kindergartenId);
    if (!allowed) return new Response(null, { status: 404 });

    return new Response(Buffer.from(target.avatar, "base64"), {
      headers: {
        "content-type": target.avatarMime,
        // Перевіряти щоразу: картинка крихітна, а показувати стару після
        // заміни гірше, ніж зайвий запит.
        "cache-control": "private, max-age=0, must-revalidate",
      },
    });
  } catch {
    return new Response(null, { status: 500 });
  }
}
