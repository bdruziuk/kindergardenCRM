"use client";
import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { BranchPicker, useBranch } from "@/components/BranchPicker";
import { Sidebar } from "@/components/Sidebar";
import type { FinanceSnapshot } from "@/lib/api-schemas";

const months = [
  ["2026-07", "Липень 2026"],
  ["2026-08", "Серпень 2026"],
  ["2026-09", "Вересень 2026"],
];

const money = (value: number) =>
  value.toLocaleString("uk-UA", { maximumFractionDigits: 2 }) + " ₴";

const dayLabel = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("uk-UA");

/** Suggestions only — the column is free text. */
const CATEGORIES = [
  "Продукти",
  "Оренда",
  "Комунальні",
  "Матеріали та іграшки",
  "Ремонт",
  "Податки",
  "Інше",
];

const EMPTY: FinanceSnapshot = {
  month: "",
  rows: [],
  salaryRows: [],
  summary: {
    income: 0,
    expense: { salary: 0, other: 0, total: 0 },
    salaryAccrued: 0,
    salaryRemaining: 0,
    balance: 0,
  },
  categories: [],
};

type Draft = {
  category: string;
  amount: string;
  occurredAt: string;
  note: string;
};

const emptyDraft = (): Draft => ({
  category: "",
  amount: "",
  occurredAt: new Date().toISOString().slice(0, 10),
  note: "",
});

export default function FinancesPage() {
  const { scope, branchId, choose, branchQuery, branchName } =
    useBranch();
  const branch = branchName;
  const [month, setMonth] = useState("2026-08");
  const [data, setData] = useState<FinanceSnapshot>(EMPTY);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/finances?month=" + month + branchQuery)
      .then((response) => response.json())
      .then((next: FinanceSnapshot) =>
        next.error ? setError(next.error) : (setData(next), setError(null)),
      )
      .catch(() => setError("Немає зв’язку із сервером"));
  }, [month, branchQuery]);

  const send = async (body: Record<string, unknown>) => {
    setSaving(true);
    const response = await fetch("/api/finances?x=1" + branchQuery, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, month }),
    });
    const next = (await response.json()) as FinanceSnapshot;
    setSaving(false);
    if (next.error) {
      setError(next.error);
      return false;
    }
    setData(next);
    setError(null);
    return true;
  };

  const monthIndex = months.findIndex((item) => item[0] === month);
  const step = (delta: number) =>
    setMonth(
      months[Math.min(months.length - 1, Math.max(0, monthIndex + delta))][0],
    );

  const { income, expense, salaryAccrued, salaryRemaining, balance } =
    data.summary;

  return (
    <main className="shell">
      <Sidebar active="/finances" />

      <section className="work finances-page">
        <header>
          <div>
            <p className="eyebrow">ФІНАНСИ</p>
            <h1>Доходи й витрати</h1>
            <p className="page-sub">
              Дохід — це оплата за садок, вона рахується автоматично. Тут
              додаються витрати
            </p>
          </div>
          <div className="actions">
            <BranchPicker
              scope={scope}
              branchId={branchId}
              onChange={choose}
            />
            <button
              className="primary staff-primary"
              onClick={() => {
                setDraft(emptyDraft());
                setAdding(true);
              }}
            >
              ＋ Додати витрату
            </button>
          </div>
        </header>

        <div className="payments-month">
          <button onClick={() => step(-1)}>‹</button>
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
          <button onClick={() => step(1)}>›</button>
        </div>

        {error && <div className="empty">{error}</div>}

        <div className="staff-stats">
          <article>
            <i>↓</i>
            <div>
              <span>Дохід</span>
              <b>{money(income)}</b>
              <small>оплата за садок</small>
            </div>
          </article>
          <article>
            <i>↑</i>
            <div>
              <span>Витрати</span>
              <b>{money(expense.total)}</b>
              <small>
                видано зарплат {money(expense.salary)} · інше{" "}
                {money(expense.other)}
              </small>
            </div>
          </article>
          <article className="salary-stat">
            <i>Σ</i>
            <div>
              <span>Баланс</span>
              <b className={balance < 0 ? "negative-balance" : undefined}>
                {money(balance)}
              </b>
              <small>
                {balance < 0 ? "витрати перевищують дохід" : "у плюсі"}
              </small>
            </div>
          </article>
          <article>
            <i>▤</i>
            <div>
              <span>Ще виплатити</span>
              <b className={salaryRemaining > 0 ? "negative-balance" : undefined}>
                {money(salaryRemaining)}
              </b>
              <small>зарплат за цей місяць</small>
            </div>
          </article>
        </div>

        <article className="panel group-payment-chart">
          <div className="group-chart-head">
            <div>
              <h2>Структура витрат</h2>
              <p>
                Частка кожної категорії у витратах місяця
                {salaryAccrued > expense.salary
                  ? ` · ще не виплачено ${money(salaryAccrued - expense.salary)} зарплат`
                  : ""}
              </p>
            </div>
          </div>
          <div className="group-chart-list">
            {data.categories.map((item) => (
              <div className="group-chart-row" key={item.category}>
                <div className="group-chart-name">
                  <b>{item.category}</b>
                  <span>{item.share}%</span>
                </div>
                <div className="category-bar">
                  <i className="expense" style={{ width: item.share + "%" }} />
                </div>
                <div className="group-chart-values">
                  <span>{money(item.amount)}</span>
                </div>
              </div>
            ))}
            {!data.categories.length && (
              <div className="empty">За цей місяць витрат ще немає.</div>
            )}
          </div>
        </article>

        <article className="panel salary-panel">
          <div className="payment-toolbar">
            <div>
              <h2>
                Зарплати <span>{data.salaryRows.length}</span>
              </h2>
              <p>Скільки нараховано за місяць і скільки вже видано</p>
            </div>
            <div className="salary-totals">
              <div>
                <span>Видано</span>
                <b className="green-text">{money(expense.salary)}</b>
              </div>
              <div>
                <span>Залишилось</span>
                <b
                  className={
                    salaryRemaining > 0 ? "negative-balance" : "green-text"
                  }
                >
                  {money(salaryRemaining)}
                </b>
              </div>
              <div>
                <span>Нараховано</span>
                <b>{money(salaryAccrued)}</b>
              </div>
            </div>
          </div>
          <div className="scroll">
            <table className="staff-table">
              <thead>
                <tr>
                  {[
                    "Працівник",
                    "Посада",
                    "Нараховано",
                    "Видано",
                    "Залишок",
                    "Прогрес",
                  ].map((item) => (
                    <th key={item}>{item}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.salaryRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <b>{row.name}</b>
                    </td>
                    <td>
                      <span className="group-pill">{row.role}</span>
                    </td>
                    <td>{money(row.accrued)}</td>
                    <td>
                      <b className="green-text">{money(row.paid)}</b>
                    </td>
                    <td>
                      <b
                        className={
                          row.remaining > 0
                            ? "negative-balance"
                            : row.remaining < 0
                              ? "amber-text"
                              : undefined
                        }
                      >
                        {row.remaining < 0
                          ? `переплата ${money(-row.remaining)}`
                          : money(row.remaining)}
                      </b>
                    </td>
                    <td>
                      <div className="salary-progress">
                        <i style={{ width: row.progress + "%" }} />
                        <span>{row.progress}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.salaryRows.length && (
              <div className="empty">Колективу за цей місяць немає.</div>
            )}
          </div>
        </article>

        <article className="panel staff-directory">
          <div className="payment-toolbar">
            <div>
              <h2>
                Витрати <span>{data.rows.length}</span>
              </h2>
              <p>Філія «{branch}» · без зарплат, вони окремою таблицею вище</p>
            </div>
          </div>
          <div className="scroll">
            <table className="staff-table">
              <thead>
                <tr>
                  {["Дата", "Категорія", "Примітка", "Сума", ""].map((item) => (
                    <th key={item}>{item}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{dayLabel(row.occurredAt)}</td>
                    <td>
                      <span className="group-pill">{row.category}</span>
                    </td>
                    <td className="finance-note">{row.note || "—"}</td>
                    <td>
                      <b className="negative-balance">−{money(row.amount)}</b>
                    </td>
                    <td>
                      <button
                        className="remove-relative"
                        disabled={saving}
                        aria-label="Видалити витрату"
                        onClick={() =>
                          send({ kind: "remove", transactionId: row.id })
                        }
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && (
              <div className="empty">
                Витрат за цей місяць ще немає.
              </div>
            )}
          </div>
        </article>
      </section>

      {adding && (
        <Modal className="modal" onClose={() => setAdding(false)}>
          <h2>Додати витрату</h2>
          <p>Те, чого застосунок не рахує сам — продукти, оренда, комунальні</p>
          <div className="form-grid">
            <label>
              Дата
              <input
                type="date"
                value={draft.occurredAt}
                onChange={(event) =>
                  setDraft({ ...draft, occurredAt: event.target.value })
                }
              />
            </label>
            <label>
              Сума
              <input
                type="number"
                min="0"
                value={draft.amount}
                onChange={(event) =>
                  setDraft({ ...draft, amount: event.target.value })
                }
              />
            </label>
            <label className="wide-field">
              Категорія
              <input
                list="finance-categories"
                value={draft.category}
                onChange={(event) =>
                  setDraft({ ...draft, category: event.target.value })
                }
                placeholder="Наприклад, Продукти"
              />
              <datalist id="finance-categories">
                {CATEGORIES.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>
            <label className="wide-field">
              Примітка
              <input
                value={draft.note}
                onChange={(event) =>
                  setDraft({ ...draft, note: event.target.value })
                }
                placeholder="Необов’язково"
              />
            </label>
          </div>
          <div className="modal-actions">
            <button onClick={() => setAdding(false)}>Скасувати</button>
            <button
              className="primary"
              disabled={
                saving || !draft.category.trim() || Number(draft.amount) <= 0
              }
              onClick={async () => {
                const ok = await send({
                  kind: "add",
                  category: draft.category,
                  amount: Number(draft.amount),
                  occurredAt: draft.occurredAt,
                  note: draft.note,
                });
                if (ok) setAdding(false);
              }}
            >
              {saving ? "Збереження…" : "Додати"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
