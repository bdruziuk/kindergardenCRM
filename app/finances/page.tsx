"use client";
import { MonthPicker } from "@/components/MonthPicker";
import { currentMonth, monthLabel } from "@/lib/period";
import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { BranchPicker, useBranch } from "@/components/BranchPicker";
import { MonthLock } from "@/components/MonthLock";
import { Sidebar } from "@/components/Sidebar";
import type {
  FinanceSnapshot,
  PaymentMethod,
  SalaryKind,
  SalaryRowDto,
} from "@/lib/api-schemas";
import { paymentMethodValues } from "@/lib/api-schemas";
import { PAYMENT_METHOD_LABELS, SALARY_KIND_LABELS } from "@/lib/format";


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
    salaryDebtTotal: 0,
    salaryOverpaidTotal: 0,
    balance: 0,
    closing: 0,
    openingKnown: false,
    openingSince: null,
  },
  debt: [],
  categories: [],
  methods: [],
};

type Draft = {
  direction: "expense" | "income";
  category: string;
  amount: string;
  method: PaymentMethod;
  occurredAt: string;
  note: string;
};

const emptyDraft = (): Draft => ({
  direction: "expense",
  category: "",
  amount: "",
  method: "cash",
  occurredAt: new Date().toISOString().slice(0, 10),
  note: "",
});

type PayoutDraft = {
  /** null — нова виплата; інакше правимо наявну. */
  id: number | null;
  kind: SalaryKind;
  amount: string;
  method: PaymentMethod;
  /** Місяць роботи, за який платять. */
  payrollMonth: string;
  /** Дата, коли гроші справді видали. */
  paidAt: string;
  note: string;
};

const emptyPayout = (payrollMonth: string): PayoutDraft => ({
  id: null,
  kind: "advance",
  amount: "",
  method: "cash",
  payrollMonth,
  paidAt: new Date().toISOString().slice(0, 10),
  note: "",
});

export default function FinancesPage() {
  const { scope, branchId, choose, branchQuery, branchName } =
    useBranch();
  const branch = branchName;
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<FinanceSnapshot>(EMPTY);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Відкритий працівник і чернетка виплати в його картці. */
  const [openStaff, setOpenStaff] = useState<number | null>(null);
  const [payout, setPayout] = useState<PayoutDraft>(() => emptyPayout(month));
  const [confirming, setConfirming] = useState<number | null>(null);

  /** Перечитує сторінку — зокрема після закриття чи відкриття місяця. */
  const reload = useCallback(() => {
    fetch("/api/finances?month=" + month + branchQuery)
      .then((response) => response.json())
      .then((next: FinanceSnapshot) =>
        next.error ? setError(next.error) : (setData(next), setError(null)),
      )
      .catch(() => setError("Немає зв’язку із сервером"));
  }, [month, branchQuery]);

  useEffect(() => {
    reload();
  }, [reload]);

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

  /** Знімок приходить новий після кожної дії, тож відкриту картку беремо з
   *  нього, а не тримаємо копію, яка встигне застаріти. */
  const selected: SalaryRowDto | null =
    data.salaryRows.find((row) => row.id === openStaff) ?? null;

  const methodSelect = (
    value: PaymentMethod,
    onPick: (method: PaymentMethod) => void,
  ) => (
    <select
      value={value}
      onChange={(event) => onPick(event.target.value as PaymentMethod)}
    >
      {paymentMethodValues.map((method) => (
        <option key={method} value={method}>
          {PAYMENT_METHOD_LABELS[method]}
        </option>
      ))}
    </select>
  );

  const savePayout = async () => {
    if (!selected || Number(payout.amount) <= 0) return;
    const ok = await send(
      payout.id
        ? {
            kind: "payout_update",
            payoutId: payout.id,
            payoutKind: payout.kind,
            amount: Number(payout.amount),
            method: payout.method,
            paidAt: payout.paidAt,
            note: payout.note,
          }
        : {
            kind: "payout_add",
            staffId: selected.id,
            payoutKind: payout.kind,
            amount: Number(payout.amount),
            method: payout.method,
            payrollMonth: payout.payrollMonth,
            paidAt: payout.paidAt,
            note: payout.note,
          },
    );
    if (ok) setPayout(emptyPayout(month));
  };


  const { income, expense, salaryAccrued, salaryRemaining, balance } =
    data.summary;
  const { openingKnown, closing, salaryDebtTotal, salaryOverpaidTotal } =
    data.summary;
  /** Нараховане й виплачене саме за той місяць роботи, який обрано у формі —
   *  він не обов'язково збігається з місяцем сторінки. */
  const payrollFigures = openStaff
    ? data.debt
        .find((person) => person.staffId === openStaff)
        ?.months.find((row) => row.month === payout.payrollMonth)
    : undefined;

  /** Борг за місяці, крім показаного: те, що тягнеться з минулого. */
  const earlierDebt = data.debt
    .map((person) => ({
      ...person,
      months: person.months.filter((row) => row.month !== month && row.remaining > 0),
    }))
    .filter((person) => person.months.length);

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
              додаються інші доходи та витрати
            </p>
          </div>
          <div className="actions">
            <BranchPicker
              scope={scope}
              branchId={branchId}
              onChange={choose}
            />
            <button className="primary staff-primary" disabled={Boolean(data.closed)} onClick={() => {
              setDraft({ ...emptyDraft(), direction: "income" }); setAdding(true);
            }}>＋ Інший дохід</button>
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

        <MonthLock
          month={month}
          closed={Boolean(data.closed)}
          closedAt={data.closedAt ?? null}
          branchQuery={branchQuery}
          onChange={reload}
        />

        <MonthPicker month={month} onChange={setMonth} />

        {error && <div className="empty">{error}</div>}

        <div className="method-totals">
          {data.methods.map((row) => (
            <article key={row.method}>
              <span>{PAYMENT_METHOD_LABELS[row.method]}</span>
              <div>
                <b className="green-text">+{money(row.income)}</b>
                <b className="negative-balance">−{money(row.expense)}</b>
              </div>
              <small
                className={
                  (openingKnown ? row.closing : row.balance) < 0
                    ? "negative-balance"
                    : undefined
                }
              >
                {openingKnown
                  ? `залишок ${money(row.closing)}`
                  : `рух ${money(row.balance)}`}
              </small>
            </article>
          ))}
        </div>

        <div className="staff-stats">
          <article>
            <i>↓</i>
            <div>
              <span>Дохід</span>
              <b>{money(income)}</b>
              <small>з них інший дохід {money(data.summary.otherIncome ?? 0)}</small>
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
              {/* Різниця доходів і витрат — це рух грошей за місяць, а не те,
                  скільки їх лишилося. Залишком її можна назвати лише тоді,
                  коли внесено, з чого рахувати. */}
              <span>{openingKnown ? "Залишок грошей" : "Рух коштів"}</span>
              <b
                className={
                  (openingKnown ? closing : balance) < 0
                    ? "negative-balance"
                    : undefined
                }
              >
                {money(openingKnown ? closing : balance)}
              </b>
              <small>
                {openingKnown
                  ? `на кінець періоду · початок ${money(closing - balance)}`
                  : "доходи мінус витрати; початкові залишки не внесені"}
              </small>
            </div>
          </article>
          <article>
            <i>▤</i>
            <div>
              <span>Ще виплатити</span>
              <b className={salaryDebtTotal > 0 ? "negative-balance" : undefined}>
                {money(salaryDebtTotal)}
              </b>
              <small>
                зарплат за всі місяці · за цей {money(salaryRemaining)}
                {salaryOverpaidTotal > 0
                  ? ` · переплата ${money(salaryOverpaidTotal)}`
                  : ""}
              </small>
            </div>
          </article>
        </div>

        {earlierDebt.length > 0 && (
          <article className="panel earlier-debt">
            <div className="group-chart-head">
              <div>
                <h2>Невиплачені зарплати за минулі місяці</h2>
                <p>
                  Натисніть на працівника, щоб виплатити — виплата піде у
                  витрати тим місяцем, яким її видано
                </p>
              </div>
            </div>
            <div className="earlier-debt-list">
              {earlierDebt.map((person) => (
                <button
                  className="earlier-debt-row"
                  key={person.staffId}
                  onClick={() => {
                    setOpenStaff(person.staffId);
                    setPayout({
                      ...emptyPayout(person.months[0].month),
                      kind: "salary",
                      amount: String(person.months[0].remaining),
                    });
                  }}
                >
                  <div>
                    <b>
                      {person.name}
                      {!person.active && <em className="left-mark">звільнений</em>}
                    </b>
                    <small>
                      {person.months
                        .map((row) => `${monthLabel(row.month)} — ${money(row.remaining)}`)
                        .join(" · ")}
                    </small>
                  </div>
                  <b className="negative-balance">{money(person.remaining)}</b>
                </button>
              ))}
            </div>
          </article>
        )}

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
                  <tr
                    key={row.id}
                    className="salary-row"
                    onClick={() => {
                      setOpenStaff(row.id);
                      setPayout(emptyPayout(month));
                      setConfirming(null);
                    }}
                  >
                    <td>
                      <b>{row.name}</b>
                      <small className="open-child">
                        {row.payouts.length
                          ? `${row.payouts.length} виплат`
                          : "виплат немає"}
                      </small>
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
                Інші доходи та витрати <span>{data.rows.length}</span>
              </h2>
              <p>Філія «{branch}» · без зарплат, вони окремою таблицею вище</p>
            </div>
          </div>
          <div className="scroll">
            <table className="staff-table">
              <thead>
                <tr>
                  {["Дата", "Категорія", "Чим", "Примітка", "Сума", ""].map((item) => (
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
                    <td>{PAYMENT_METHOD_LABELS[row.method]}</td>
                    <td className="finance-note">{row.note || "—"}</td>
                    <td>
                      <b className={row.direction === "income" ? "green-text" : "negative-balance"}>{row.direction === "income" ? "+" : "−"}{money(row.amount)}</b>
                    </td>
                    <td>
                      <button
                        className="remove-relative"
                        disabled={saving}
                        aria-label="Видалити операцію"
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
                Операцій за цей місяць ще немає.
              </div>
            )}
          </div>
        </article>
      </section>

      {adding && (
        <Modal className="modal" onClose={() => setAdding(false)}>
          <h2>{draft.direction === "income" ? "Додати інший дохід" : "Додати витрату"}</h2>
          <p>{draft.direction === "income" ? "Вкажіть джерело, суму та спосіб отримання доходу" : "Продукти, оренда, комунальні та інші витрати"}</p>
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
                min="0.01"
                step="0.01"
                value={draft.amount}
                onChange={(event) =>
                  setDraft({ ...draft, amount: event.target.value })
                }
              />
            </label>
            <label>
              {draft.direction === "income" ? "Як отримали" : "Чим заплатили"}
              {methodSelect(draft.method, (method) =>
                setDraft({ ...draft, method }),
              )}
            </label>
            <label className="wide-field">
              Категорія
              <input
                list="finance-categories"
                value={draft.category}
                onChange={(event) =>
                  setDraft({ ...draft, category: event.target.value })
                }
                placeholder={draft.direction === "income" ? "Наприклад, додаткові заняття" : "Наприклад, Продукти"}
              />
              <datalist id="finance-categories">
                {(draft.direction === "income" ? ["Додаткові заняття", "Повернення коштів", "Інше"] : CATEGORIES).map((item) => (
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
                  direction: draft.direction,
                  category: draft.category,
                  amount: Number(draft.amount),
                  method: draft.method,
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
      {selected && (
        <Modal
          className="modal payout-modal"
          onClose={() => {
            setOpenStaff(null);
            setConfirming(null);
          }}
        >
          <h2>{selected.name}</h2>
          <p>
            {selected.role} · за {monthLabel(month)}: нараховано{" "}
            {money(selected.accrued)}, виплачено за цей місяць роботи{" "}
            {money(selected.paid)}
            {selected.remaining > 0
              ? `, ще виплатити ${money(selected.remaining)}`
              : selected.remaining < 0
                ? `, переплата ${money(-selected.remaining)}`
                : ""}
          </p>

          <div className="payout-history">
            {selected.payouts.map((item) => (
              <article key={item.id}>
                <div>
                  <b>{money(item.amount)}</b>
                  <small>
                    {SALARY_KIND_LABELS[item.kind]} ·{" "}
                    {PAYMENT_METHOD_LABELS[item.method]} ·{" "}
                    {dayLabel(item.paidAt)}
                    {item.note ? ` · ${item.note}` : ""}
                  </small>
                </div>
                {confirming === item.id ? (
                  <div className="payment-confirm">
                    <button
                      className="danger-confirm"
                      disabled={saving}
                      onClick={async () => {
                        await send({
                          kind: "payout_remove",
                          payoutId: item.id,
                        });
                        setConfirming(null);
                        if (payout.id === item.id) setPayout(emptyPayout(month));
                      }}
                    >
                      {saving ? "…" : "Видалити"}
                    </button>
                    <button onClick={() => setConfirming(null)}>×</button>
                  </div>
                ) : (
                  <div className="payout-actions">
                    <button
                      className="row-action"
                      title="Змінити"
                      aria-label={`Змінити виплату ${money(item.amount)}`}
                      onClick={() =>
                        setPayout({
                          id: item.id,
                          kind: item.kind,
                          amount: String(item.amount),
                          method: item.method,
                          payrollMonth: month,
                          paidAt: item.paidAt,
                          note: item.note,
                        })
                      }
                    >
                      ✎
                    </button>
                    <button
                      className="remove-relative"
                      title="Видалити"
                      aria-label={`Видалити виплату ${money(item.amount)}`}
                      onClick={() => setConfirming(item.id)}
                    >
                      ×
                    </button>
                  </div>
                )}
              </article>
            ))}
            {!selected.payouts.length && (
              <div className="empty">
                За {monthLabel(month)} виплат ще не було.
              </div>
            )}
          </div>

          <p className="payout-hint">
            Виплата гасить зарплату за вибраний місяць роботи, а у витрати
            потрапляє за датою, коли гроші справді видали. Це різні місяці,
            якщо за вересень платять у жовтні.
          </p>

          <div className="payroll-figures">
            <div>
              <span>Нараховано за {monthLabel(payout.payrollMonth)}</span>
              <b>{money(payrollFigures?.accrued ?? 0)}</b>
            </div>
            <div>
              <span>Виплачено за цей місяць роботи</span>
              <b>{money(payrollFigures?.paid ?? 0)}</b>
            </div>
            <div>
              <span>
                {payrollFigures?.overpaid ? "Переплата" : "Ще виплатити"}
              </span>
              <b
                className={
                  payrollFigures?.remaining
                    ? "negative-balance"
                    : payrollFigures?.overpaid
                      ? undefined
                      : "green-text"
                }
              >
                {money(payrollFigures?.overpaid || payrollFigures?.remaining || 0)}
              </b>
            </div>
          </div>

          <div className="form-grid payout-form">
            <label>
              За який місяць
              {payout.id ? (
                <input value={monthLabel(payout.payrollMonth)} readOnly />
              ) : (
                <input
                  type="month"
                  value={payout.payrollMonth}
                  onChange={(event) =>
                    setPayout({ ...payout, payrollMonth: event.target.value || month })
                  }
                />
              )}
            </label>
            <label>
              Вид
              <select
                value={payout.kind}
                onChange={(event) =>
                  setPayout({
                    ...payout,
                    kind: event.target.value as SalaryKind,
                  })
                }
              >
                <option value="advance">{SALARY_KIND_LABELS.advance}</option>
                <option value="salary">{SALARY_KIND_LABELS.salary}</option>
              </select>
            </label>
            <label>
              Сума
              <input
                type="number"
                min="0"
                value={payout.amount}
                onChange={(event) =>
                  setPayout({ ...payout, amount: event.target.value })
                }
              />
            </label>
            <label>
              Чим видано
              {methodSelect(payout.method, (method) =>
                setPayout({ ...payout, method }),
              )}
            </label>
            <label>
              Дата фактичної виплати
              <input
                type="date"
                value={payout.paidAt}
                onChange={(event) =>
                  setPayout({ ...payout, paidAt: event.target.value })
                }
              />
            </label>
            <label>
              Примітка
              <input
                value={payout.note}
                onChange={(event) =>
                  setPayout({ ...payout, note: event.target.value })
                }
                placeholder="Необов’язково"
              />
            </label>
          </div>

          <div className="modal-actions">
            {payout.id && (
              <button onClick={() => setPayout(emptyPayout(month))}>
                Скасувати правку
              </button>
            )}
            <button
              className="primary"
              disabled={saving || Number(payout.amount) <= 0}
              onClick={savePayout}
            >
              {saving
                ? "Збереження…"
                : payout.id
                  ? "Зберегти виплату"
                  : "Додати виплату"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
