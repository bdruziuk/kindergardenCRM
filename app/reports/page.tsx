"use client";
import { useEffect, useState } from "react";
import { BranchPicker, useBranch } from "@/components/BranchPicker";
import { Sidebar } from "@/components/Sidebar";
import type { ReportsSnapshot } from "@/lib/api-schemas";
import {
  WAITLIST_STATUS_LABELS,
  moneyLabel,
  monthsLabel,
} from "@/lib/format";

const MONTHS_SHORT = [
  "січ",
  "лют",
  "бер",
  "кві",
  "тра",
  "чер",
  "лип",
  "сер",
  "вер",
  "жов",
  "лис",
  "гру",
];

const thisYear = new Date().getFullYear();
const YEARS = [thisYear - 1, thisYear, thisYear + 1];

const MONTHS_FULL = [
  "Січень",
  "Лютий",
  "Березень",
  "Квітень",
  "Травень",
  "Червень",
  "Липень",
  "Серпень",
  "Вересень",
  "Жовтень",
  "Листопад",
  "Грудень",
];

const EMPTY: ReportsSnapshot = {
  period: "year",
  year: thisYear,
  month: null,
  months: [],
  totals: {
    income: 0,
    salaryPaid: 0,
    otherExpenses: 0,
    expenses: 0,
    balance: 0,
    bestMonth: null,
  },
  categories: [],
  groups: [],
  children: { inPeriod: 0, joined: 0, left: 0, paused: 0 },
  staff: [],
  waitlist: { waiting: 0, invited: 0, enrolled: 0, declined: 0, total: 0 },
};

export default function ReportsPage() {
  const { scope, branchId, choose, branchQuery } = useBranch();
  const [year, setYear] = useState(thisYear);
  const [period, setPeriod] = useState<"year" | "month">("year");
  const [month, setMonth] = useState(
    `${thisYear}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
  );
  const [data, setData] = useState<ReportsSnapshot>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query =
      period === "month" ? `month=${month}` : `year=${year}`;
    fetch("/api/reports?" + query + branchQuery)
      .then((response) => response.json())
      .then((next: ReportsSnapshot) =>
        next.error ? setError(next.error) : (setData(next), setError(null)),
      )
      .catch(() => setError("Немає зв’язку із сервером"));
  }, [year, month, period, branchQuery]);

  // One scale for both bars so income and expenses stay visually comparable.
  const peak = Math.max(
    1,
    ...data.months.map((row) => Math.max(row.income, row.expenses)),
  );
  const active = data.months.filter(
    (row) => row.income || row.expenses,
  );

  return (
    <main className="shell">
      <Sidebar active="/reports" />

      <section className="work reports-page">
        <header>
          <div>
            <p className="eyebrow">ЗВІТИ</p>
            <h1>
              {period === "month"
                ? `Звіт за ${MONTHS_FULL[Number(month.slice(5)) - 1]} ${year}`
                : `Звіти за ${year} рік`}
            </h1>
            <p className="page-sub">
              Динаміка доходів і витрат, наповнюваність та виплати
            </p>
          </div>
          <div className="actions">
            <BranchPicker
              scope={scope}
              branchId={branchId}
              onChange={choose}
            />
            <label>
              <small>Рік</small>
              <select
                value={year}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setYear(next);
                  // keep the month inside the chosen year
                  setMonth((current) => `${next}-${current.slice(5)}`);
                }}
              >
                {YEARS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            {period === "month" && (
              <label>
                <small>Місяць</small>
                <select
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                >
                  {MONTHS_FULL.map((name, index) => (
                    <option
                      key={name}
                      value={`${year}-${String(index + 1).padStart(2, "0")}`}
                    >
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </header>

        <div className="period-switch">
          <div className="view-switch">
            {(
              [
                ["year", "За рік"],
                ["month", "За місяць"],
              ] as const
            ).map(([value, label]) => (
              <button
                className={period === value ? "active" : ""}
                key={value}
                onClick={() => setPeriod(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="empty">{error}</div>}

        <div className="staff-stats">
          <article>
            <i>↓</i>
            <div>
              <span>Дохід за {period === "month" ? "місяць" : "рік"}</span>
              <b>{moneyLabel(data.totals.income)}</b>
              <small>
                {data.totals.bestMonth
                  ? `найкращий місяць — ${
                      MONTHS_SHORT[
                        Number(data.totals.bestMonth.slice(5)) - 1
                      ]
                    }`
                  : "оплат ще немає"}
              </small>
            </div>
          </article>
          <article>
            <i>↑</i>
            <div>
              <span>Витрати за {period === "month" ? "місяць" : "рік"}</span>
              <b>{moneyLabel(data.totals.expenses)}</b>
              <small>
                зарплати {moneyLabel(data.totals.salaryPaid)} · інше{" "}
                {moneyLabel(data.totals.otherExpenses)}
              </small>
            </div>
          </article>
          <article className="salary-stat">
            <i>Σ</i>
            <div>
              <span>Баланс</span>
              <b
                className={
                  data.totals.balance < 0 ? "negative-balance" : undefined
                }
              >
                {moneyLabel(data.totals.balance)}
              </b>
              <small>
                {period === "month"
                  ? "за вибраний місяць"
                  : `${monthsLabel(active.length)} із рухом`}
              </small>
            </div>
          </article>
          <article>
            <i>♧</i>
            <div>
              <span>
                {period === "month"
                  ? `Дітей у ${MONTHS_FULL[Number(month.slice(5)) - 1].toLowerCase()}`
                  : `Дітей у ${year} році`}
              </span>
              <b>{data.children.inPeriod}</b>
              <small>
                прийшли {data.children.joined} · вибули {data.children.left} ·
                пауза зараз {data.children.paused}
              </small>
            </div>
          </article>
        </div>

        <article className="panel">
          <div className="group-chart-head">
            <div>
              <h2>Дохід і витрати за місяцями</h2>
              <p>Отримані оплати проти виданих грошей</p>
            </div>
            <div className="chart-legend">
              <span>
                <i className="paid-color" /> Дохід
              </span>
              <span>
                <i className="balance-color" /> Витрати
              </span>
            </div>
          </div>
          <div className="year-chart">
            {data.months.map((row) => (
              <div
                className={
                  "year-col" +
                  (period === "month" && row.month === month ? " selected" : "")
                }
                key={row.month}
              >
                <div className="year-bars">
                  <i
                    className="income"
                    style={{ height: `${(row.income / peak) * 100}%` }}
                    title={`Дохід: ${moneyLabel(row.income)}`}
                  />
                  <i
                    className="expense"
                    style={{ height: `${(row.expenses / peak) * 100}%` }}
                    title={`Витрати: ${moneyLabel(row.expenses)}`}
                  />
                </div>
                <span>{MONTHS_SHORT[Number(row.month.slice(5)) - 1]}</span>
              </div>
            ))}
          </div>
          {!active.length && (
            <div className="empty">За {year} рік руху коштів ще немає.</div>
          )}
        </article>

        <div className="reports-grid">
          <article className="panel">
            <div className="group-chart-head">
              <div>
                <h2>Структура витрат</h2>
                <p>Частка категорій за {period === "month" ? "місяць" : "рік"}</p>
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
                    <span>{moneyLabel(item.amount)}</span>
                  </div>
                </div>
              ))}
              {!data.categories.length && (
                <div className="empty">Витрат за рік немає.</div>
              )}
            </div>
          </article>

          <article className="panel">
            <div className="group-chart-head">
              <div>
                <h2>Наповнюваність груп</h2>
                <p>
                  {period === "month"
                    ? `Діти в групах у ${MONTHS_FULL[Number(month.slice(5)) - 1].toLowerCase()}`
                    : `Діти в групах за ${year} рік`}
                </p>
              </div>
            </div>
            <div className="group-chart-list">
              {data.groups.map((item) => (
                <div className="group-chart-row" key={item.name}>
                  <div className="group-chart-name">
                    <b>{item.name}</b>
                    <span>{item.children}</span>
                  </div>
                  <div className="category-bar">
                    <i
                      className="income"
                      style={{
                        width: `${
                          data.children.inPeriod
                            ? (item.children / data.children.inPeriod) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              ))}
              {!data.groups.length && (
                <div className="empty">Груп ще немає.</div>
              )}
            </div>
          </article>
        </div>

        <div className="reports-grid">
          <article className="panel staff-directory">
            <div className="payment-toolbar">
              <div>
                <h2>Виплати колективу</h2>
                <p>
                  {period === "month"
                    ? `Нараховано та видано за ${MONTHS_FULL[Number(month.slice(5)) - 1].toLowerCase()}`
                    : `Видано за ${year} рік`}
                </p>
              </div>
            </div>
            <div className="scroll">
              <table className="staff-table reports-table">
                <thead>
                  <tr>
                    {(period === "month"
                      ? ["Працівник", "Посада", "Нараховано", "Видано", "Залишок"]
                      : ["Працівник", "Посада", "Видано"]
                    ).map((item) => (
                      <th key={item}>{item}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.staff.map((person) => (
                    <tr key={person.id}>
                      <td>
                        <b>{person.name}</b>
                      </td>
                      <td>
                        <span className="group-pill">{person.role}</span>
                      </td>
                      {person.accrued !== null && (
                        <td>{moneyLabel(person.accrued)}</td>
                      )}
                      <td>
                        <b className={person.paid ? "green-text" : undefined}>
                          {moneyLabel(person.paid)}
                        </b>
                      </td>
                      {person.remaining !== null && (
                        <td>
                          <b
                            className={
                              person.remaining > 0
                                ? "negative-balance"
                                : undefined
                            }
                          >
                            {moneyLabel(person.remaining)}
                          </b>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.staff.length && (
                <div className="empty">Колективу немає.</div>
              )}
            </div>
          </article>

          <article className="panel">
            <div className="group-chart-head">
              <div>
                <h2>Черга</h2>
                <p>Стан заявок на місце</p>
              </div>
            </div>
            <div className="waitlist-summary">
              {(
                Object.keys(WAITLIST_STATUS_LABELS) as (keyof typeof WAITLIST_STATUS_LABELS)[]
              ).map((status) => (
                <div key={status}>
                  <span>{WAITLIST_STATUS_LABELS[status]}</span>
                  <b>{data.waitlist[status]}</b>
                </div>
              ))}
              <div className="waitlist-total">
                <span>Усього заявок</span>
                <b>{data.waitlist.total}</b>
              </div>
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
