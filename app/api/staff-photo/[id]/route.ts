import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { getDb } from "@/db";
import { branches, staff, users } from "@/db/schema";
import { authOptions } from "@/lib/auth";

/**
 * Фото працівника картинкою — так само, як /api/avatar/{id} для користувачів:
 * знімок не мандрує в кожній відповіді API, а список ставить
 * `<img src="/api/staff-photo/{id}">` і покладається на кеш браузера.
 *
 * Видно його тим, кому видно самого працівника: власнику — в межах свого
 * садочка, керуючому й вихователю — лише своєї філії, супер-адміністратору —
 * будь-яке. Інакше фото людей витягувалися б перебором id.
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
        .select({
          role: users.role,
          kindergartenId: users.kindergartenId,
          branchId: users.branchId,
        })
        .from(users)
        .where(eq(users.id, Number(session.user.id))),
      db
        .select({
          photo: staff.photo,
          photoMime: staff.photoMime,
          branchId: staff.branchId,
          kindergartenId: branches.kindergartenId,
        })
        .from(staff)
        .innerJoin(branches, eq(branches.id, staff.branchId))
        .where(eq(staff.id, wanted)),
    ]);

    if (!viewer || !target?.photo || !target.photoMime)
      return new Response(null, { status: 404 });

    const allowed =
      viewer.role === "superadmin" ||
      (viewer.kindergartenId !== null &&
        viewer.kindergartenId === target.kindergartenId &&
        (viewer.role === "admin" || viewer.branchId === target.branchId));
    if (!allowed) return new Response(null, { status: 404 });

    return new Response(Buffer.from(target.photo, "base64"), {
      headers: {
        "content-type": target.photoMime,
        // Перевіряти щоразу: показувати старе фото після заміни гірше, ніж
        // зайвий запит за крихітною картинкою.
        "cache-control": "private, max-age=0, must-revalidate",
      },
    });
  } catch {
    return new Response(null, { status: 500 });
  }
}
