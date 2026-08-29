"use client";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { BranchPicker, useBranch } from "@/components/BranchPicker";
import { Sidebar } from "@/components/Sidebar";
import {
  type ChildPaymentsDto,
  type PaymentsSnapshot,
  paymentMethodValues,
} from "@/lib/api-schemas";
import { PAYMENT_METHOD_LABELS } from "@/lib/format";

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
  const [draft, setDraft] = useState<{
    amount: string;
    method: Method;
    paidAt: string;
  }>({
    amount: "",
    method: "cash",
    paidAt: new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    fetch("/api/payments?month=" + month + branchQuery)
      .then((response) => response.json())
      .then((next) => {
        setData(next);
        setSelected(null);
      });
  }, [month, branchQuery]);

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

  const addPayment = async () => {
    if (!selected || Number(draft.amount) <= 0) return;
    setSaving(true);
    const response = await fetch("/api/payments?x=1" + branchQuery, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        childId: selected.id,
        month,
        amount: Number(draft.amount),
        method: draft.method,
        paidAt: draft.paidAt,
      }),
    });
    const next = (await response.json()) as PaymentsSnapshot;
    setSaving(false);
    if (next.rows) {
      setData(next);
      const updated = next.rows.find((row) => row.id === selected.id);
      setSelected(updated ?? null);
      setDraft({
        amount: updated?.balance ? String(updated.balance) : "",
        method: "cash",
        paidAt: new Date().toISOString().slice(0, 10),
      });
    }
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
              <button
                className="save-payment"
                disabled={saving || Number(draft.amount) <= 0}
                onClick={addPayment}
              >
                {saving ? "Збереження…" : "＋ Додати часткову оплату"}
              </button>
            </div>

            <div className="child-payment-history">
              <div className="history-title">
                <h3>Часткові оплати</h3>
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
