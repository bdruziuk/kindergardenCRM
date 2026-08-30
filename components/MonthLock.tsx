"use client";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { dayLabel } from "@/lib/format";

/**
 * Стан закритого місяця й кнопка закриття.
 *
 * Один компонент на всі три сторінки місяця — «Оплати», «Колектив», «Доходи й
 * витрати»: закриття стосується місяця цілком, і показувати його по-різному
 * означало б натякати, що вони закриваються окремо.
 *
 * `closed` приходить у знімку кожної сторінки, тож окремого запиту за станом
 * не потрібно.
 */
export function MonthLock({
  month,
  closed,
  closedAt,
  branchQuery,
  onChange,
}: {
  month: string;
  closed: boolean;
  closedAt: string | null;
  branchQuery: string;
  /** Знімок сторінки треба перечитати: закриття міняє все, що на ній видно. */
  onChange: () => void;
}) {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "admin";
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (action: "close" | "open") => {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/month-close?x=1" + branchQuery, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ month, action }),
    });
    const result = (await response.json()) as { error?: string };
    setBusy(false);
    setAsking(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onChange();
  };

  if (closed)
    return (
      <div className="month-lock closed">
        <i>🔒</i>
        <span>
          Місяць закритий{closedAt ? ` ${dayLabel(closedAt.slice(0, 10))}` : ""}{" "}
          — дані збережені такими, якими були тоді, і не змінюються.
        </span>
        {isOwner && (
          <button disabled={busy} onClick={() => send("open")}>
            {busy ? "Відкриваємо…" : "Відкрити місяць"}
          </button>
        )}
        {error && <em>{error}</em>}
      </div>
    );

  return (
    <div className="month-lock">
      {asking ? (
        <>
          <span>
            Закрити місяць? Далі його не можна буде редагувати
            {isOwner ? " — відкрити назад зможете ви." : "; відкрити зможе лише власник."}
          </span>
          <button
            className="danger-confirm"
            disabled={busy}
            onClick={() => send("close")}
          >
            {busy ? "Закриваємо…" : "Так, закрити"}
          </button>
          <button onClick={() => setAsking(false)}>Скасувати</button>
        </>
      ) : (
        <>
          <span>
            Місяць відкритий — усе, що видно, рахується за сьогоднішніми платою
            та ставками.
          </span>
          <button onClick={() => setAsking(true)}>Закрити місяць</button>
        </>
      )}
      {error && <em>{error}</em>}
    </div>
  );
}
