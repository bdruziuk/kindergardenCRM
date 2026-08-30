import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { children, paymentReceipts, payments } from "@/db/schema";
import { resolveScope, scopeFailure } from "@/lib/scope";

/**
 * Віддає квитанцію, прикріплену до оплати: `/api/receipt/{paymentId}`.
 *
 * Без `?download=1` — показує в браузері (`inline`), з ним — пропонує зберегти.
 * Це та сама відповідь, різниця лише в заголовку, тож переглянути й скачати
 * можна один і той самий файл, не тримаючи двох маршрутів.
 *
 * Оплата належить філії через дитину — саме через неї й перевіряємо доступ,
 * інакше чужу квитанцію можна було б відкрити, підставивши номер.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { branchId } = await resolveScope(
      new URL(request.url).searchParams.get("branch"),
    );

    const paymentId = Number((await params).id);
    if (!Number.isInteger(paymentId) || paymentId <= 0)
      return new Response(null, { status: 404 });

    const [row] = await getDb()
      .select({
        fileName: paymentReceipts.fileName,
        mime: paymentReceipts.mime,
        data: paymentReceipts.data,
      })
      .from(paymentReceipts)
      .innerJoin(payments, eq(payments.id, paymentReceipts.paymentId))
      .innerJoin(children, eq(children.id, payments.childId))
      .where(
        and(
          eq(paymentReceipts.paymentId, paymentId),
          eq(children.branchId, branchId),
        ),
      );

    if (!row) return new Response(null, { status: 404 });

    const download = new URL(request.url).searchParams.has("download");
    return new Response(Buffer.from(row.data, "base64"), {
      headers: {
        "content-type": row.mime,
        "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
        "cache-control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (error) {
    return scopeFailure(error) ?? new Response(null, { status: 500 });
  }
}
