"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { BranchPicker, useBranch } from "@/components/BranchPicker";
import { MonthLock } from "@/components/MonthLock";
import { Sidebar } from "@/components/Sidebar";
import {
  type ChildPaymentsDto,
  type PaymentsSnapshot,
  paymentMethodValues,
} from "@/lib/api-schemas";
import { PAYMENT_METHOD_LABELS } from "@/lib/format";

/** Обмеження на бік браузера. Сервер перевіряє те саме, але сказати про
 *  завеликий файл до відправки чесніше, ніж після. */
const MAX_BYTES = 3 * 1024 * 1024;

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024
    ? (bytes / 1024 / 1024).toFixed(1) + " МБ"
    : Math.max(1, Math.round(bytes / 1024)) + " КБ";

/**
 * Готує файл до відправки: зображення зменшується до 1600 px по довшій
 * стороні, PDF іде як є.
 *
 * Фото квитанції з телефона важить кілька мегабайтів, а читати з нього треба
 * лише цифри — зменшення робить вкладення легшим на порядок, не втрачаючи
 * розбірливості.
 */
async function prepareFile(file: File): Promise<{ name: string; dataUrl: string }> {
  const asDataUrl = () =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Не вдалося прочитати файл"));
      reader.readAsDataURL(file);
    });

  if (file.type === "application/pdf") {
    if (file.size > MAX_BYTES) throw new Error("PDF завеликий — до 3 МБ");
    return { name: file.name, dataUrl: await asDataUrl() };
  }

  const bitmap = await createImageBitmap(file);
  const side = Math.max(bitmap.width, bitmap.height);
  const scale = side > 1600 ? 1600 / side : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Браузер не дав полотна для обробки зображення");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const webp = canvas.toDataURL("image/webp", 0.82);
  const dataUrl = webp.startsWith("data:image/webp")
    ? webp
    : canvas.toDataURL("image/jpeg", 0.82);
  if (dataUrl.length > 4_000_000) throw new Error("Зображення завелике");
  return { name: file.name, dataUrl };
}

const months = [
  ["2026-07", "Липень 2026"],
  ["2026-08", "Серпень 2026"],
  ["2026-09", "Вересень 2026"],
];
const money = (value: number) =>
  value.toLocaleString("uk-UA", { maximumFractionDigits: 2 }) + " ₴";

type Method = (typeof paymentMethodValues)[number];

const METHOD_ICONS: Record<Method, string> = {
  cash: "₴",
  iban: "IB",
  card: "▣",
};

export default function PaymentsPage() {
  const { scope, branchId, choose, branchQuery, branchName } =
    useBranch();
  const branch = branchName;
  const [month, setMonth] = useState("2026-08");
  const [data, setData] = useState<PaymentsSnapshot>({
    month: "",
    rows: [],
    summary: {
      planned: 0,
      received: 0,
      balance: 0,
      progress: 0,
      paidCount: 0,
      partialCount: 0,
      unpaidCount: 0,
    },
  });
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("Усі групи");
  const [selected, setSelected] = useState<ChildPaymentsDto | null>(null);
  const [saving, setSaving] = useState(false);
  /** Яку оплату зараз перепитуємо перед видаленням. */
  const [confirming, setConfirming] = useState<number | null>(null);
  /** Квитанція, обрана для нової оплати, і стан обробки файлу. */
  const [receipt, setReceipt] = useState<{
    name: string;
    dataUrl: string;
  } | null>(null);
  const [fileBusy, setFileBusy] = useState(false);

  /** Читає файл із поля й кладе його або в чернетку нової оплати, або одразу
   *  на наявну — залежно від того, звідки його обрали. */
  const pickFile = async (file: File | undefined, paymentId?: number) => {
    if (!file) return;
    setFileBusy(true);
    try {
      const prepared = await prepareFile(file);
      if (paymentId === undefined) {
        setReceipt(prepared);
      } else {
        await send({ kind: "receipt_set", paymentId, month, receipt: prepared });
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Не вдалося прочитати файл",
      );
    } finally {
      setFileBusy(false);
    }
  };
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    amount: string;
    method: Method;
    paidAt: string;
  }>({
    amount: "",
    method: "cash",
    paidAt: new Date().toISOString().slice(0, 10),
  });

  /** Перечитує сторінку. Потрібне не лише на старті: закриття місяця міняє
   *  все, що на ній видно. */
  const reload = useCallback(() => {
    fetch("/api/payments?month=" + month + branchQuery)
      .then((response) => response.json())
      .then((next) => {
        setData(next);
        setSelected(null);
      });
  }, [month, branchQuery]);

  useEffect(() => {
    reload();
  }, [reload]);

  const groups = useMemo(
    () => [...new Set(data.rows.map((row) => row.group))] as string[],
    [data.rows],
  );
  const shown = useMemo(
    () =>
      data.rows.filter(
        (row) =>
          row.name.toLowerCase().includes(query.toLowerCase()) &&
          (group === "Усі групи" || row.group === group),
      ),
    [data.rows, query, group],
  );
  const methodTotals = useMemo(() => {
    const totals: Record<string, number> = { cash: 0, iban: 0, card: 0 };
    data.rows.forEach((row) =>
      row.history.forEach((item) => {
        totals[item.method] = (totals[item.method] ?? 0) + item.amount;
      }),
    );
    return totals;
  }, [data.rows]);
  const groupStats = useMemo(
    () =>
      groups.map((groupName) => {
        const rows = data.rows.filter((row) => row.group === groupName);
        const planned = rows.reduce(
          (sum, row) => sum + row.fee,
          0,
        );
        const paid = rows.reduce((sum, row) => sum + row.paid, 0);
        return {
          name: groupName,
          planned,
          paid,
          balance: Math.max(planned - paid, 0),
          progress: planned
            ? Math.min(100, Math.round((paid / planned) * 100))
            : 0,
        };
      }),
    [data.rows, groups],
  );

  const openChild = (row: ChildPaymentsDto) => {
    setSelected(row);
    setDraft({
      amount: row.balance ? String(row.balance) : "",
      method: "cash",
      paidAt: new Date().toISOString().slice(0, 10),
    });
  };

  /** Одна відправка на всі дії сторінки: знімок приходить новий після кожної,
   *  і відкрита картка має слідувати за ним. */
  const send = async (body: Record<string, unknown>) => {
    setSaving(true);
    const response = await fetch("/api/payments?x=1" + branchQuery, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const next = (await response.json()) as PaymentsSnapshot;
    setSaving(false);
    if (next.error || !next.rows) {
      setError(next.error ?? "Не вдалося зберегти");
      return null;
    }

    setError(null);
    setData(next);
    if (selected) {
      const updated = next.rows.find((row) => row.id === selected.id);
      setSelected(updated ?? null);
      setDraft({
        amount: updated?.balance ? String(updated.balance) : "",
        method: "cash",
        paidAt: new Date().toISOString().slice(0, 10),
      });
    }
    return next;
  };

  /** Видалення оплати. Підтверджуємо у два кроки: суму не відновити, а
   *  сусідні рядки в списку виглядають однаково — промахнутися легко. */
  const removePayment = async (paymentId: number) => {
    await send({ kind: "remove", paymentId, month });
    setConfirming(null);
  };

  const addPayment = async () => {
    if (!selected || Number(draft.amount) <= 0) return;
    const next = await send({
      kind: "add",
      childId: selected.id,
      month,
      amount: Number(draft.amount),
      method: draft.method,
      paidAt: draft.paidAt,
      receipt,
    });
    if (next) setReceipt(null);
  };

  return (
    <main className="shell">
      <Sidebar active="/payments" />

      <section className="work payments-page">
        <header>
          <div>
            <p className="eyebrow">ФІНАНСИ</p>
            <h1>Оплати</h1>
            <p className="page-sub">
              Оберіть дитину, щоб переглянути або додати оплату
            </p>
          </div>
          <div className="actions">
            <BranchPicker
              scope={scope}
              branchId={branchId}
              onChange={choose}
            />
          </div>
        </header>

        <MonthLock
          month={month}
          closed={Boolean(data.closed)}
          closedAt={data.closedAt ?? null}
          branchQuery={branchQuery}
          onChange={reload}
        />

        <div className="payments-month">
          <button
            onClick={() =>
              setMonth(
                months[
                  Math.max(0, months.findIndex((item) => item[0] === month) - 1)
                ][0],
              )
            }
          >
            ‹
          </button>
          <select
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          >
            {months.map((item) => (
              <option value={item[0]} key={item[0]}>
                {item[1]}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              setMonth(
                months[
                  Math.min(
                    months.length - 1,
                    months.findIndex((item) => item[0] === month) + 1,
                  )
                ][0],
              )
            }
          >
            ›
          </button>
        </div>

        <section className="payment-results">
          <div className="method-stats">
            <article className="method-stat total-method">
              <i>Σ</i>
              <div>
                <span>Усього отримано</span>
                <b>{money(data.summary?.received ?? 0)}</b>
              </div>
            </article>
            {paymentMethodValues.map((method) => (
              <article className="method-stat" key={method}>
                <i>{METHOD_ICONS[method]}</i>
                <div>
                  <span>{PAYMENT_METHOD_LABELS[method]}</span>
                  <b>{money(methodTotals[method] ?? 0)}</b>
                </div>
              </article>
            ))}
          </div>

          <article className="panel group-payment-chart">
            <div className="group-chart-head">
              <div>
                <h2>Оплати по групах</h2>
                <p>Сплачено та залишилось за вибраний місяць</p>
              </div>
              <div className="chart-legend">
                <span>
                  <i className="paid-color" /> Оплачено
                </span>
                <span>
                  <i className="balance-color" /> Залишилось
                </span>
              </div>
            </div>
            <div className="group-chart-list">
              {groupStats.map((item) => (
                <div className="group-chart-row" key={item.name}>
                  <div className="group-chart-name">
                    <b>{item.name}</b>
                    <span>{item.progress}%</span>
                  </div>
                  <div className="stacked-payment-bar">
                    <i style={{ width: item.progress + "%" }} />
                  </div>
                  <div className="group-chart-values">
                    <b>{money(item.paid)} оплачено</b>
                    <span>{money(item.balance)} залишилось</span>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <article className="panel payment-directory simple-payment-list">
          <div className="payment-toolbar">
            <div>
              <h2>
                Список дітей <span>{shown.length}</span>
              </h2>
              <p>Один рядок на дитину · філія «{branch}»</p>
            </div>
            <div className="payment-filters">
              <label className="search">
                ⌕
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Пошук дитини…"
                />
              </label>
              <select
                value={group}
                onChange={(event) => setGroup(event.target.value)}
              >
                <option>Усі групи</option>
                {groups.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="scroll">
            <table className="payments-table simple-payments-table">
              <thead>
                <tr>
                  {[
                    "Дитина",
                    "Група",
                    "Плата за місяць",
                    "Стан оплати",
                    "",
                  ].map((item) => (
                    <th key={item}>{item}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id} onClick={() => openChild(row)}>
                    <td>
                      <i className="avatar">{row.initials}</i>
                      <div>
                        <b>{row.name}</b>
                        <small>
                          {row.history.length
                            ? row.history.length + " частк. оплат"
                            : "Оплат ще немає"}
                        </small>
                      </div>
                    </td>
                    <td>
                      <span className="group-pill">{row.group}</span>
                    </td>
                    <td>
                      <b>{money(row.fee)}</b>
                    </td>
                    <td>
                      <span
                        className={
                          "badge " +
                          (row.status === "Сплачено"
                            ? "paid"
                            : row.status === "Частково"
                              ? "partial"
                              : "unpaid")
                        }
                      >
                        {row.status}
                      </span>
                    </td>
                    <td>
                      <span className="open-child">Відкрити →</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && (
              <div className="empty">Дітей за цим фільтром не знайдено.</div>
            )}
          </div>
        </article>
      </section>

      {selected && (
        <Modal
          className={"drawer payment-child-drawer"}
          onClose={() => setSelected(null)}
        >
            <div className="payment-child-head">
              <i>{selected.initials}</i>
              <div>
                <p className="eyebrow">ОПЛАТИ ДИТИНИ</p>
                <h2>{selected.name}</h2>
                <span>
                  {selected.group} ·{" "}
                  {months.find((item) => item[0] === month)?.[1]}
                </span>
              </div>
            </div>
            <div className="child-payment-summary">
              <p>
                <span>Нараховано</span>
                <b>{money(selected.fee)}</b>
              </p>
              <p>
                <span>Внесено</span>
                <b className="green-text">{money(selected.paid)}</b>
              </p>
              <p>
                <span>Залишок</span>
                <b>{money(selected.balance)}</b>
              </p>
              <span
                className={
                  "badge " +
                  (selected.status === "Сплачено"
                    ? "paid"
                    : selected.status === "Частково"
                      ? "partial"
                      : "unpaid")
                }
              >
                {selected.status}
              </span>
            </div>

            <div className="child-payment-form">
              <h3>Додати оплату</h3>
              <div className="payment-entry-grid">
                <label>
                  Сума
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={draft.amount}
                    onChange={(event) =>
                      setDraft({ ...draft, amount: event.target.value })
                    }
                  />
                </label>
                <label>
                  Спосіб
                  <select
                    value={draft.method}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        method: event.target.value as Method,
                      })
                    }
                  >
                    {paymentMethodValues.map((method) => (
                      <option key={method} value={method}>
                        {PAYMENT_METHOD_LABELS[method]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Дата
                  <input
                    type="date"
                    value={draft.paidAt}
                    onChange={(event) =>
                      setDraft({ ...draft, paidAt: event.target.value })
                    }
                  />
                </label>
              </div>

              <div className="receipt-pick">
                <label>
                  {fileBusy
                    ? "Готуємо файл…"
                    : receipt
                      ? "Замінити квитанцію"
                      : "＋ Прикріпити квитанцію"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    disabled={fileBusy || saving}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      // Скидаємо одразу, щоб той самий файл можна було обрати
                      // вдруге після невдачі.
                      event.target.value = "";
                      pickFile(file);
                    }}
                  />
                </label>
                {receipt && (
                  <span className="receipt-chosen">
                    {receipt.name}
                    <button
                      type="button"
                      aria-label="Прибрати обрану квитанцію"
                      onClick={() => setReceipt(null)}
                    >
                      ×
                    </button>
                  </span>
                )}
              </div>

              {error && <p className="login-error">{error}</p>}

              <button
                className="save-payment"
                disabled={saving || fileBusy || Number(draft.amount) <= 0}
                onClick={addPayment}
              >
                {saving ? "Збереження…" : "＋ Додати оплату"}
              </button>
            </div>

            <div className="child-payment-history">
              <div className="history-title">
                <h3>Оплати</h3>
                <span>{selected.history.length}</span>
              </div>
              <div className="history-list">
                {selected.history.map((item) => (
                  <article key={item.id}>
                    <i>{METHOD_ICONS[item.method]}</i>
                    <div>
                      <b>{money(item.amount)}</b>
                      <small>
                        {PAYMENT_METHOD_LABELS[item.method]} ·{" "}
                        {new Date(item.paidAt + "T00:00:00").toLocaleDateString(
                          "uk-UA",
                        )}
                      </small>
                    </div>
                    {item.receipt ? (
                      <div className="receipt-links">
                        <a
                          href={`/api/receipt/${item.id}${branchQuery.replace("&", "?")}`}
                          target="_blank"
                          rel="noreferrer"
                          title={`${item.receipt.name} · ${sizeLabel(item.receipt.size)}`}
                        >
                          Переглянути
                        </a>
                        <a
                          href={`/api/receipt/${item.id}?download=1${branchQuery}`}
                          title="Зберегти файл"
                        >
                          Завантажити
                        </a>
                        <button
                          type="button"
                          className="receipt-drop"
                          aria-label="Прибрати квитанцію"
                          disabled={saving}
                          onClick={() =>
                            send({
                              kind: "receipt_remove",
                              paymentId: item.id,
                              month,
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <label className="receipt-attach">
                        {fileBusy ? "…" : "Квитанція"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,application/pdf"
                          disabled={fileBusy || saving}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            pickFile(file, item.id);
                          }}
                        />
                      </label>
                    )}
                    {confirming === item.id ? (
                      <div className="payment-confirm">
                        <button
                          className="danger-confirm"
                          disabled={saving}
                          onClick={() => removePayment(item.id)}
                        >
                          {saving ? "…" : "Видалити"}
                        </button>
                        <button onClick={() => setConfirming(null)}>×</button>
                      </div>
                    ) : (
                      <button
                        className="remove-relative"
                        title="Видалити оплату"
                        aria-label={`Видалити оплату ${money(item.amount)}`}
                        onClick={() => setConfirming(item.id)}
                      >
                        ×
                      </button>
                    )}
                  </article>
                ))}
                {!selected.history.length && (
                  <div className="empty">За цей місяць оплат ще немає.</div>
                )}
              </div>
            </div>
          </Modal>
      )}
    </main>
  );
}
