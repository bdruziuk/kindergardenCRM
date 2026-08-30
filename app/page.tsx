"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BranchPicker, useBranch } from "@/components/BranchPicker";
import { MonthLock } from "@/components/MonthLock";
import { Sidebar } from "@/components/Sidebar";
import type { DashboardDto } from "@/app/api/dashboard/route";
import { initialsOf, moneyLabel, yearsLabel } from "@/lib/format";

const months = [
  ["2026-07", "Липень 2026"],
  ["2026-08", "Серпень 2026"],
  ["2026-09", "Вересень 2026"],
];

/** Feeds a percentage into the conic-gradient rings via a CSS variable. */
const pct = (value: number) =>
  ({ "--pct": `${Math.min(100, Math.max(0, value))}%` }) as React.CSSProperties;

/** Share of the month's accrued salary that has actually been handed over. */
function payoutRate(data: DashboardDto | null): number {
  if (!data?.salary.accrued) return 0;
  return Math.min(100, Math.round((data.salary.paid / data.salary.accrued) * 100));
}

const whenLabel = (daysAway: number) =>
  daysAway === 0
    ? "Сьогодні"
    : daysAway === 1
      ? "Завтра"
      : daysAway === 2
        ? "Післязавтра"
        : `Через ${daysAway} дні`;

const today = () =>
  new Date()
    .toLocaleDateString("uk-UA", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })
    .toUpperCase();

export default function Home() {
  const { scope, branchId, choose, branchQuery } = useBranch();
  const [month, setMonth] = useState("2026-08");
  const [data, setData] = useState<DashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState("");

  // The date comes from the viewer's clock, so it can only be filled in
  // after hydration — rendering it on the server would mismatch.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setDate(today()), []);

  /** Перечитує огляд — зокрема після закриття чи відкриття місяця. */
  const reload = useCallback(() => {
    fetch("/api/dashboard?month=" + month + branchQuery)
      .then((response) => response.json())
      .then((next) =>
        next.error ? setError(next.error) : (setData(next), setError(null)),
      )
      .catch(() => setError("Немає зв’язку із сервером"));
  }, [month, branchQuery]);

  useEffect(() => {
    reload();
  }, [reload]);

  const monthIndex = months.findIndex((item) => item[0] === month);
  const step = (delta: number) =>
    setMonth(
      months[Math.min(months.length - 1, Math.max(0, monthIndex + delta))][0],
    );

  return (
    <main className="shell">
      <Sidebar active="/" />
      <section className="work">
        <header>
          <div>
            <p className="eyebrow">{date}</p>
            <h1>Огляд</h1>
          </div>
          <div className="actions">
            <button className="bell">♢</button>
            <BranchPicker
              scope={scope}
              branchId={branchId}
              onChange={choose}
            />
            <Link className="primary button-link" href="/payments">
              ＋ Додати оплату
            </Link>
          </div>
        </header>

        <MonthLock
          month={month}
          closed={Boolean(data?.closed)}
          closedAt={data?.closedAt ?? null}
          branchQuery={branchQuery}
          onChange={reload}
        />

        <div className="month">
          <div>
            <button onClick={() => step(-1)}>‹</button>
            <b>{months[monthIndex]?.[1] ?? month}</b>
            <button onClick={() => step(1)}>›</button>
          </div>
          <p>
            <i className="green" />
            Сплачено <i className="yellow" />
            Частково <i className="red" />
            Не сплачено
          </p>
        </div>

        {error && <div className="empty">{error}</div>}

        <div className="stats">
          <Card
            icon="₴"
            title="Отримано оплат"
            value={moneyLabel(data?.payments.received ?? 0)}
            note={`${data?.payments.progress ?? 0}% від запланованих`}
          />
          <Card
            icon="♧"
            title="Дітей у садочку"
            value={String(data?.children.active ?? 0)}
            note={`у ${data?.children.groups ?? 0} групах`}
          />
          <Card
            icon="◷"
            title="Очікуємо оплат"
            value={moneyLabel(data?.payments.balance ?? 0)}
            note={`${data?.children.awaiting ?? 0} дітей`}
          />
          <Card
            icon="↗"
            title="Витрати за місяць"
            value={moneyLabel(data?.expenses.total ?? 0)}
            note={`з них зарплати ${moneyLabel(data?.expenses.salary ?? 0)}`}
          />
        </div>

        <div className="grids">
          <article className="panel">
            <Top
              title="Оплата за садочок"
              sub={`Прогрес по групах · ${months[monthIndex]?.[1] ?? month}`}
              href="/payments"
            />
            <div className="chart">
              <div className="donut" style={pct(data?.payments.progress ?? 0)}>
                <b>{data?.payments.progress ?? 0}%</b>
                <small>зібрано</small>
              </div>
              <div className="charttext">
                <h2>{moneyLabel(data?.payments.received ?? 0)}</h2>
                <p>із запланованих {moneyLabel(data?.payments.planned ?? 0)}</p>
                <div className="bar">
                  <i style={{ width: `${data?.payments.progress ?? 0}%` }} />
                </div>
                <small>
                  {data?.payments.paidCount ?? 0} сплатили ·{" "}
                  {data?.children.awaiting ?? 0} очікуємо
                </small>
              </div>
            </div>
            <div className="groups">
              {(data?.groupProgress ?? []).slice(0, 3).map((item) => (
                <div key={item.name}>
                  <span>{item.name}</span>
                  <b>{item.progress}%</b>
                  <i>
                    <em style={{ width: item.progress + "%" }} />
                  </i>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <Top
              title="Виплата зарплат"
              sub={months[monthIndex]?.[1] ?? month}
              href="/staff"
            />
            <div className="salary">
              <div className="ring" style={pct(payoutRate(data))}>
                <b>{payoutRate(data)}%</b>
              </div>
              <div>
                <p>Виплачено</p>
                <h2>{moneyLabel(data?.salary.paid ?? 0)}</h2>
                <small>
                  із нарахованих {moneyLabel(data?.salary.accrued ?? 0)}
                </small>
              </div>
            </div>
            <div className="statuses">
              <p>
                <i className="green" />
                Відпрацьовано днів <b>{data?.salary.workedDays ?? 0}</b>
              </p>
              <p>
                <i className="green" />
                Проведено занять <b>{data?.salary.lessonCount ?? 0}</b>
              </p>
              <p>
                <i className="yellow" />
                Ще не виплачено{" "}
                <b>
                  {moneyLabel(
                    Math.max(
                      (data?.salary.accrued ?? 0) - (data?.salary.paid ?? 0),
                      0,
                    ),
                  )}
                </b>
              </p>
              <p>
                <i className="red" />
                Заборгованість з оплат{" "}
                <b>{moneyLabel(data?.payments.balance ?? 0)}</b>
              </p>
            </div>
          </article>
        </div>

        <article className="panel tablepanel">
          <Top
            title="Дні народження"
            sub="Сьогодні та найближчі три дні"
            href="/children"
          />
          <div className="birthday-list">
            {(data?.birthdays ?? []).map((person) => (
              <article
                className={"birthday " + person.kind}
                key={`${person.kind}-${person.id}`}
              >
                <i>{initialsOf(person.name)}</i>
                <div>
                  <b>{person.name}</b>
                  <small>
                    {person.kind === "child" ? "Дитина" : "Працівник"}
                    {person.detail ? ` · ${person.detail}` : ""}
                  </small>
                </div>
                <div className="birthday-when">
                  <b>{whenLabel(person.daysAway)}</b>
                  <small>
                    {new Date(person.date + "T00:00:00").toLocaleDateString(
                      "uk-UA",
                      { day: "numeric", month: "long" },
                    )}
                    {person.turning ? ` · ${yearsLabel(person.turning)}` : ""}
                  </small>
                </div>
              </article>
            ))}
            {data && !data.birthdays.length && (
              <div className="empty">
                Найближчими днями днів народження немає.
              </div>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}

function Card({
  icon,
  title,
  value,
  note,
}: {
  icon: string;
  title: string;
  value: string;
  note: string;
}) {
  return (
    <article className="card">
      <i>{icon}</i>
      <div>
        <p>{title}</p>
        <h2>{value}</h2>
        <small>{note}</small>
      </div>
    </article>
  );
}

function Top({
  title,
  sub,
  href,
}: {
  title: string;
  sub: string;
  href: string;
}) {
  return (
    <div className="top">
      <div>
        <h3>{title}</h3>
        <p>{sub}</p>
      </div>
      <Link className="button-link" href={href}>
        Детальніше →
      </Link>
    </div>
  );
}
