"use client";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import type { MonthCloseCheck } from "@/lib/api-schemas";
import { PAYMENT_METHOD_LABELS, dayLabel, moneyLabel } from "@/lib/format";
import { monthLabel } from "@/lib/period";

/** Скільки імен показати в попередженні; решта — одним рядком «і ще N». */
const LIST_LIMIT = 6;

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
  // Закриває й відкриває той, хто веде філію; вихователь лише бачить стан.
  const role = session?.user?.role;
  const canManage = role === "admin" || role === "manager";
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<MonthCloseCheck | null>(null);

  // Перед закриттям — перевірка: боргів, невиданої зарплати й каси. Без неї
  // місяць легко закрити, поки частину оплат ще не внесли, і тоді знімок
  // фіксує неповну картину.
  const ask = async () => {
    setAsking(true);
    setCheck(null);
    setError(null);
    const response = await fetch(
      `/api/month-close?check=1&month=${month}` + branchQuery,
    );
    const result = (await response.json()) as MonthCloseCheck & { error?: string };
    if (result.error) {
      setAsking(false);
      setError(result.error);
      return;
    }
    setCheck(result);
  };

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
        {canManage && (
          <button disabled={busy} onClick={() => send("open")}>
            {busy ? "Відкриваємо…" : "Відкрити місяць"}
          </button>
        )}
        {error && <em>{error}</em>}
      </div>
    );

  return (
    <div className="month-lock">
      <span>
        Місяць відкритий — усе, що видно, рахується за сьогоднішніми платою та
        ставками.
      </span>
      {canManage && (
        <button disabled={asking} onClick={ask}>
          {asking && !check ? "Перевіряємо…" : "Закрити місяць"}
        </button>
      )}
      {error && <em>{error}</em>}
      {asking && check && (
        <Modal
          className="modal close-check"
          labelledBy="close-check-title"
          onClose={() => setAsking(false)}
        >
          <h2 id="close-check-title">Закрити {monthLabel(month)}?</h2>
          <p>
            Після закриття місяць не можна редагувати, поки його не відкриють
            знову. Перевірте підсумок.
          </p>

          <h3>Каса за місяць</h3>
          <div className="close-check-methods">
            {check.methods.map((item) => (
              <div key={item.method} className={item.method}>
                <b>{PAYMENT_METHOD_LABELS[item.method]}</b>
                <span>
                  Прийшло <strong>+{moneyLabel(item.income)}</strong>
                </span>
                <span>
                  Витрачено <strong>−{moneyLabel(item.expense)}</strong>
                </span>
                <span className="close-check-left">
                  {item.method === "cash" ? "Залишилось у касі" : "Залишок"}{" "}
                  <strong>{moneyLabel(item.closing)}</strong>
                </span>
              </div>
            ))}
          </div>

          {check.unpaid.count > 0 ? (
            <div className="close-check-warning">
              <b>
                Не сплачено за {check.unpaid.count}{" "}
                {plural(check.unpaid.count, "дитину", "дитини", "дітей")} —{" "}
                {moneyLabel(check.unpaid.total)}
              </b>
              <span>
                Якщо батьки вже заплатили, внесіть оплати до закриття: після
                нього їх не можна буде додати.
              </span>
              <NameList
                rows={check.unpaid.rows.map((row) => ({
                  key: row.id,
                  name: row.name,
                  detail: row.group,
                  amount: row.balance,
                }))}
              />
            </div>
          ) : (
            <div className="close-check-ok">Усі оплати за місяць внесено.</div>
          )}

          {check.salary.count > 0 ? (
            <div className="close-check-warning">
              <b>
                Не видано зарплату {check.salary.count}{" "}
                {plural(check.salary.count, "працівнику", "працівникам", "працівникам")}{" "}
                — {moneyLabel(check.salary.total)}
              </b>
              <span>
                Виплату за цей місяць можна внести й після закриття, якщо її
                видають у наступному місяці.
              </span>
              <NameList
                rows={check.salary.rows.map((row) => ({
                  key: row.id,
                  name: row.name,
                  amount: row.remaining,
                }))}
              />
            </div>
          ) : (
            <div className="close-check-ok">Зарплату за місяць видано повністю.</div>
          )}

          {error && <p className="modal-error">{error}</p>}
          <div className="modal-actions">
            <button onClick={() => setAsking(false)}>Скасувати</button>
            <button
              className="danger-confirm"
              disabled={busy}
              onClick={() => send("close")}
            >
              {busy ? "Закриваємо…" : "Закрити місяць"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NameList({
  rows,
}: {
  rows: { key: number; name: string; detail?: string; amount: number }[];
}) {
  const shown = rows.slice(0, LIST_LIMIT);
  return (
    <ul>
      {shown.map((row) => (
        <li key={row.key}>
          <span>
            {row.name}
            {row.detail && <small> · {row.detail}</small>}
          </span>
          <strong>{moneyLabel(row.amount)}</strong>
        </li>
      ))}
      {rows.length > shown.length && (
        <li className="more-names">і ще {rows.length - shown.length}</li>
      )}
    </ul>
  );
}

/** 1 дитина, 2 дитини, 5 дітей — у знахідному відмінку, як у реченні вище. */
function plural(count: number, one: string, few: string, many: string) {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
}
