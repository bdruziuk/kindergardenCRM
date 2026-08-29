"use client";
import { useEffect, useMemo, useState } from "react";
import { AttendanceGrid } from "@/components/AttendanceGrid";
import { LessonEditor } from "@/components/LessonEditor";
import { Modal } from "@/components/Modal";
import { BranchPicker, useBranch } from "@/components/BranchPicker";
import { Sidebar } from "@/components/Sidebar";
import type {
  SalaryKind,
  SalaryType,
  StaffRowDto,
  StaffSnapshot,
} from "@/lib/api-schemas";
import {
  ATTENDANCE_KIND_LABELS,
  ATTENDANCE_KIND_MARKS,
  SALARY_KIND_LABELS,
  SALARY_TYPE_LABELS,
  leaveOverrun,
  leaveWarning,
  lessonsLabel,
} from "@/lib/format";

const months = [
  ["2026-07", "Липень 2026"],
  ["2026-08", "Серпень 2026"],
  ["2026-09", "Вересень 2026"],
];
const money = (value: number) =>
  value.toLocaleString("uk-UA", { maximumFractionDigits: 2 }) + " ₴";

type StaffDraft = {
  staffId: number;
  name: string;
  role: string;
  birthDate: string;
  salaryType: SalaryType;
  monthlyRate: string;
  dailyRate: string;
  lessonRate: string;
  vacationQuota: string;
  dayOffQuota: string;
};

type PayoutDraft = {
  kind: SalaryKind;
  amount: string;
  paidAt: string;
  note: string;
};

const emptyPayout = (): PayoutDraft => ({
  kind: "advance",
  amount: "",
  paidAt: new Date().toISOString().slice(0, 10),
  note: "",
});

type NewStaffDraft = {
  name: string;
  role: string;
  birthDate: string;
  salaryType: SalaryType;
  monthlyRate: string;
  dailyRate: string;
  lessonRate: string;
  vacationQuota: string;
  dayOffQuota: string;
};

export default function StaffPage() {
  const { scope, branchId, choose, branchQuery, branchName } =
    useBranch();
  const branch = branchName;
  const [month, setMonth] = useState("2026-08");
  const [data, setData] = useState<StaffSnapshot>({
    jobTitles: [],
    month: "",
    calendar: [],
    workdays: 0,
    rows: [],
    summary: {
      staffCount: 0,
      workedDays: 0,
      absentDays: 0,
      lessonCount: 0,
      vacationDays: 0,
      dayOffDays: 0,
      salaryTotal: 0,
      paidOutTotal: 0,
    },
  });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<StaffRowDto | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StaffDraft | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [payout, setPayout] = useState<PayoutDraft>(emptyPayout);
  const [view, setView] = useState<"list" | "grid">("list");
  /** Попередження про перевищення лімітів після останньої відмітки дня. */
  const [warning, setWarning] = useState<string | null>(null);
  /** Which person/day the grid opened a lesson editor for. */
  const [gridLessons, setGridLessons] = useState<{
    person: StaffRowDto;
    date: string;
  } | null>(null);
  const [newStaff, setNewStaff] = useState<NewStaffDraft>({
    name: "",
    role: "Вихователь",
    birthDate: "",
    salaryType: "monthly",
    monthlyRate: "25000",
    dailyRate: "1200",
    lessonRate: "400",
    vacationQuota: "24",
    dayOffQuota: "5",
  });

  useEffect(() => {
    fetch("/api/staff?month=" + month + branchQuery)
      .then((response) => response.json())
      .then((next) => {
        setData(next);
        setSelected(null);
      });
  }, [month, branchQuery]);

  const shown = useMemo(
    () =>
      data.rows.filter(
        (person) =>
          person.name.toLowerCase().includes(query.toLowerCase()) ||
          person.role.toLowerCase().includes(query.toLowerCase()),
      ),
    [data.rows, query],
  );

  /** worked → absent → vacation → paid day off → unmarked → … */
  const nextState = (current?: string) =>
    current === "worked"
      ? "absent"
      : current === "absent"
        ? "vacation"
        : current === "vacation"
          ? "day_off"
          : current === "day_off"
            ? "unmarked"
            : "worked";

  /** Every mutation returns a fresh snapshot; whatever is open follows it. */
  const staffAction = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/staff?x=1" + branchQuery, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, month }),
    });
    const next = (await response.json()) as StaffSnapshot;
    if (!next.rows) return null;
    setData(next);
    setSelected((current) =>
      current ? (next.rows.find((row) => row.id === current.id) ?? null) : null,
    );
    setGridLessons((current) => {
      if (!current) return null;
      const person = next.rows.find((row) => row.id === current.person.id);
      return person ? { person, date: current.date } : null;
    });
    return next;
  };

  /** Ліміт нічого не блокує — він лише показує баланс, — тож перевищення
   *  повідомляємо після відмітки, а не замість неї. */
  const updateAttendance = async (
    staffId: number,
    date: string,
    state: string,
  ) => {
    const next = await staffAction({
      kind: "attendance",
      staffId,
      date,
      state,
    });
    const person = next?.rows.find((row) => row.id === staffId);
    setWarning(person ? leaveWarning(person) : null);
  };

  return (
    <main className="shell">
      <Sidebar active="/staff" />

      <section className="work staff-page">
        <header>
          <div>
            <p className="eyebrow">КОМАНДА</p>
            <h1>Колектив</h1>
            <p className="page-sub">
              Робочі дні, ставки та автоматичний розрахунок зарплати
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
              onClick={() => setAdding(true)}
            >
              ＋ Додати працівника
            </button>
          </div>
        </header>

        {warning && (
          <div className="limit-warning" role="status">
            <i>!</i>
            <span>{warning}</span>
            <button
              onClick={() => setWarning(null)}
              aria-label="Сховати попередження"
            >
              ×
            </button>
          </div>
        )}

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

        <div className="staff-stats">
          <article>
            <i>♙</i>
            <div>
              <span>Працівників</span>
              <b>{data.summary?.staffCount ?? 0}</b>
              <small>{data.workdays ?? 0} робочих днів у місяці</small>
            </div>
          </article>
          <article className="absent-stat">
            <i>×</i>
            <div>
              <span>Не відпрацьовано</span>
              <b>{data.summary?.absentDays ?? 0} днів</b>
              <small>за відмітками</small>
            </div>
          </article>
          <article className="salary-stat">
            <i>₴</i>
            <div>
              <span>Нараховано зарплати</span>
              <b>{money(data.summary?.salaryTotal ?? 0)}</b>
              <small>видано {money(data.summary?.paidOutTotal ?? 0)}</small>
            </div>
          </article>
        </div>

        <article className="panel staff-directory">
          <div className="payment-toolbar">
            <div>
              <h2>
                Список колективу <span>{shown.length}</span>
              </h2>
              <p>Філія «{branch}»</p>
            </div>
            <div className="toolbar-right">
              <div className="view-switch">
                {(
                  [
                    ["list", "Список"],
                    ["grid", "Табель"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    className={view === value ? "active" : ""}
                    key={value}
                    onClick={() => setView(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="search">
                ⌕
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Пошук за ім’ям або посадою…"
                />
              </label>
            </div>
          </div>
          {view === "grid" ? (
            <>
              <AttendanceGrid
                rows={shown}
                calendar={data.calendar}
                onCycleAttendance={(person, date) =>
                  updateAttendance(
                    person.id,
                    date,
                    nextState(person.marks[date]),
                  )
                }
                onOpenLessons={(person, date) =>
                  setGridLessons({ person, date })
                }
              />
              <p className="calendar-help">
                Клік по клітинці змінює стан: ✓ відпрацьовано → × не
                відпрацьовано → В відпустка → О оплачуваний вихідний → не
                відмічено. Відпустка й оплачуваний вихідний оплачуються як
                робочий день. У вчителів на занятті клітинка відкриває список
                занять того дня.
              </p>
            </>
          ) : (
          <div className="scroll">
            <table className="staff-table">
              <thead>
                <tr>
                  {[
                    "Працівник",
                    "Посада",
                    "Тип оплати",
                    "Дні",
                    "Нараховано",
                    "",
                  ].map((item) => (
                    <th key={item}>{item}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((person) => (
                  <tr
                    key={person.id}
                    onClick={() => {
                      setSelected(person);
                      setOpenDay(null);
                    }}
                  >
                    <td>
                      <i className="avatar">
                        {person.name
                          .split(" ")
                          .map((part: string) => part[0])
                          .slice(0, 2)
                          .join("")}
                      </i>
                      <div>
                        <b>{person.name}</b>
                      </div>
                    </td>
                    <td>
                      <span className="group-pill">{person.role}</span>
                    </td>
                    <td>
                      <b>{SALARY_TYPE_LABELS[person.salaryType]}</b>
                      <small className="salary-rate">
                        {person.salaryType === "monthly"
                          ? money(person.monthlyRate)
                          : person.salaryType === "lesson"
                            ? money(person.lessonRate) + " / заняття"
                            : money(person.dailyRate) + " / день"}
                      </small>
                    </td>
                    <td>
                      <div className="days-count">
                        {person.salaryType === "lesson" ? (
                          <b className="worked-count">
                            {person.lessonCount} ♪
                          </b>
                        ) : (
                          <>
                            <b className="worked-count">
                              {person.workedDays} ✓
                            </b>
                            <b className="absent-count">
                              {person.absentDays} ×
                            </b>
                          </>
                        )}
                      </div>
                    </td>
                    <td>
                      <b className="salary-value">{money(person.salary)}</b>
                    </td>
                    <td>
                      <span className="open-child">Календар →</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </article>
      </section>

      {selected && (
        <Modal
          className={"drawer attendance-drawer"}
          onClose={() => {
            setSelected(null);
            setOpenDay(null);
          }}
        >
            <div className="staff-drawer-head">
              <i>
                {selected.name
                  .split(" ")
                  .map((part: string) => part[0])
                  .slice(0, 2)
                  .join("")}
              </i>
              <div>
                <p className="eyebrow">ТАБЕЛЬ ПРАЦІВНИКА</p>
                <h2>{selected.name}</h2>
                <span>
                  {selected.role} ·{" "}
                  {months.find((item) => item[0] === month)?.[1]}
                </span>
              </div>
            </div>
            <div className="staff-salary-card">
              <div>
                <span>
                  {selected.salaryType === "lesson" ? "Проведено" : "Оплачено"}
                </span>
                <b>
                  {selected.salaryType === "lesson"
                    ? lessonsLabel(selected.lessonCount)
                    : `${selected.paidDays} із ${data.workdays} днів`}
                </b>
              </div>
              <div>
                <span>Нараховано</span>
                <b className="green-text">{money(selected.salary)}</b>
              </div>
              <small>
                {selected.salaryType === "monthly"
                  ? "Розрахунок пропорційно відпрацьованим дням зі ставки " +
                    money(selected.monthlyRate)
                  : selected.salaryType === "lesson"
                    ? `${selected.lessonCount} × ${money(selected.lessonRate)}`
                    : selected.paidDays + " дн. × " + money(selected.dailyRate)}
              </small>
              <button
                className="edit-rate-button"
                onClick={() =>
                  setEditing({
                    staffId: selected.id,
                    name: selected.name,
                    role: selected.role,
                    birthDate: selected.birthDate ?? "",
                    salaryType: selected.salaryType,
                    monthlyRate: String(selected.monthlyRate),
                    dailyRate: String(selected.dailyRate),
                    lessonRate: String(selected.lessonRate),
                    vacationQuota: String(selected.vacationQuota),
                    dayOffQuota: String(selected.dayOffQuota),
                  })
                }
              >
                Редагувати працівника
              </button>
            </div>
            {selected.salaryType !== "lesson" &&
              (selected.vacationQuota > 0 || selected.dayOffQuota > 0) && (
                <div className="leave-block">
                  <div
                    className={
                      leaveOverrun(selected).vacation ? "over" : undefined
                    }
                  >
                    <span>Відпустка</span>
                    <b>
                      {selected.vacationUsedYear} із {selected.vacationQuota}
                    </b>
                    <small>
                      залишилось{" "}
                      {Math.max(
                        selected.vacationQuota - selected.vacationUsedYear,
                        0,
                      )}{" "}
                      днів цього року
                    </small>
                  </div>
                  <div
                    className={
                      leaveOverrun(selected).dayOff ? "over" : undefined
                    }
                  >
                    <span>Оплачувані вихідні</span>
                    <b>
                      {selected.dayOffDays} із {selected.dayOffQuota}
                    </b>
                    <small>
                      залишилось{" "}
                      {Math.max(
                        selected.dayOffQuota - selected.dayOffDays,
                        0,
                      )}{" "}
                      днів цього місяця
                    </small>
                  </div>
                </div>
              )}

            <div className="payout-block">
              <div className="payout-summary">
                <div>
                  <span>Нараховано</span>
                  <b>{money(selected.salary)}</b>
                </div>
                <div>
                  <span>Видано</span>
                  <b>{money(selected.paidOut.total)}</b>
                  <small>
                    аванс {money(selected.paidOut.advance)} · зарплата{" "}
                    {money(selected.paidOut.salary)}
                  </small>
                </div>
                <div>
                  <span>
                    {selected.remaining < 0 ? "Переплата" : "Залишок"}
                  </span>
                  <b
                    className={
                      selected.remaining > 0 ? "negative-balance" : "green-text"
                    }
                  >
                    {money(Math.abs(selected.remaining))}
                  </b>
                </div>
              </div>

              <div className="payout-list">
                {selected.payouts.map((item) => (
                  <div className="payout-row" key={item.id}>
                    <i className={item.kind}>
                      {item.kind === "advance" ? "А" : "З"}
                    </i>
                    <div>
                      <b>{money(item.amount)}</b>
                      <small>
                        {SALARY_KIND_LABELS[item.kind]} ·{" "}
                        {new Date(
                          item.paidAt + "T00:00:00",
                        ).toLocaleDateString("uk-UA")}
                        {item.note ? ` · ${item.note}` : ""}
                      </small>
                    </div>
                    <button
                      className="remove-relative"
                      aria-label="Видалити виплату"
                      onClick={() =>
                        staffAction({
                          kind: "payout_remove",
                          payoutId: item.id,
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                {!selected.payouts.length && (
                  <p className="lesson-empty">
                    Виплат за цей місяць ще не було.
                  </p>
                )}
              </div>

              <div className="payout-add">
                <select
                  value={payout.kind}
                  onChange={(event) =>
                    setPayout({
                      ...payout,
                      kind: event.target.value as SalaryKind,
                    })
                  }
                >
                  <option value="advance">Аванс</option>
                  <option value="salary">Зарплата</option>
                </select>
                <input
                  type="number"
                  min="0"
                  placeholder="Сума"
                  value={payout.amount}
                  onChange={(event) =>
                    setPayout({ ...payout, amount: event.target.value })
                  }
                />
                <input
                  type="date"
                  value={payout.paidAt}
                  onChange={(event) =>
                    setPayout({ ...payout, paidAt: event.target.value })
                  }
                />
                <input
                  placeholder="Примітка"
                  value={payout.note}
                  onChange={(event) =>
                    setPayout({ ...payout, note: event.target.value })
                  }
                />
                <button
                  className="primary"
                  disabled={Number(payout.amount) <= 0}
                  onClick={async () => {
                    await staffAction({
                      kind: "payout_add",
                      staffId: selected.id,
                      payoutKind: payout.kind,
                      amount: Number(payout.amount),
                      paidAt: payout.paidAt,
                      note: payout.note,
                    });
                    setPayout(emptyPayout());
                  }}
                >
                  ＋ Видати
                </button>
              </div>
            </div>

            <div className="attendance-legend">
              {selected.salaryType === "lesson" ? (
                <>
                  <span>
                    <i className="day-worked" /> Є заняття
                  </span>
                  <span>
                    <i className="day-empty" /> Занять немає
                  </span>
                </>
              ) : (
                <>
                  <span>
                    <i className="day-worked" /> Відпрацьовано
                  </span>
                  <span>
                    <i className="day-absent" /> Не відпрацьовано
                  </span>
                  <span>
                    <i className="day-vacation" /> Відпустка
                  </span>
                  <span>
                    <i className="day-off" /> Оплачуваний вихідний
                  </span>
                  <span>
                    <i className="day-empty" /> Не відмічено
                  </span>
                </>
              )}
            </div>
            <div className="calendar-weekdays">
              {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"].map((day) => (
                <b key={day}>{day}</b>
              ))}
            </div>
            <div className="attendance-calendar">
              {Array.from(
                {
                  length:
                    (new Date(
                      data.calendar?.[0]?.date + "T00:00:00",
                    ).getUTCDay() +
                      6) %
                    7,
                },
                (_, index) => (
                  <i className="calendar-spacer" key={"s" + index} />
                ),
              )}
              {data.calendar.map((day) => {
                if (selected.salaryType === "lesson") {
                  const taught = selected.lessons[day.date] ?? [];
                  return (
                    <button
                      className={
                        (taught.length ? "worked-day" : "empty-day") +
                        (day.weekend ? " weekend-day" : "") +
                        (openDay === day.date ? " open-day" : "")
                      }
                      key={day.date}
                      onClick={() => {
                        setOpenDay(day.date);
                      }}
                    >
                      <b>{day.day}</b>
                      <span>{taught.length ? `${taught.length} ♪` : "·"}</span>
                    </button>
                  );
                }
                const state = selected.marks[day.date];
                return (
                  <button
                    className={
                      (state ? `${state.replace("_", "-")}-day` : "empty-day") +
                      (day.weekend ? " weekend-day" : "")
                    }
                    title={
                      state ? ATTENDANCE_KIND_LABELS[state] : "Не відмічено"
                    }
                    key={day.date}
                    onClick={() =>
                      updateAttendance(
                        selected.id,
                        day.date,
                        nextState(state),
                      )
                    }
                  >
                    <b>{day.day}</b>
                    <span>{state ? ATTENDANCE_KIND_MARKS[state] : "·"}</span>
                  </button>
                );
              })}
            </div>
            {selected.salaryType !== "lesson" ? (
              <p className="calendar-help">
                Натискайте на день, щоб змінити стан: відпрацьовано → не
                відпрацьовано → відпустка → оплачуваний вихідний → не відмічено.
              </p>
            ) : !openDay ? (
              <p className="calendar-help">
                Натисніть на день, щоб додати заняття. Днів без занять може бути
                скільки завгодно — вони просто не потраплять у розрахунок.
              </p>
            ) : (
              <div className="lesson-day">
                <div className="lesson-day-head">
                  <b>
                    {new Date(openDay + "T00:00:00").toLocaleDateString(
                      "uk-UA",
                      { day: "numeric", month: "long" },
                    )}
                  </b>
                  <button onClick={() => setOpenDay(null)}>Згорнути</button>
                </div>
                <LessonEditor
                  lessons={selected.lessons[openDay] ?? []}
                  onAdd={(note) =>
                    staffAction({
                      kind: "lesson_add",
                      staffId: selected.id,
                      date: openDay,
                      note,
                    })
                  }
                  onUpdateNote={(lessonId, note) =>
                    staffAction({ kind: "lesson_note", lessonId, note })
                  }
                  onRemove={(lessonId) =>
                    staffAction({ kind: "lesson_remove", lessonId })
                  }
                />
              </div>
            )}
          </Modal>
      )}

      {gridLessons && (
        <Modal
          className="modal lesson-modal"
          onClose={() => setGridLessons(null)}
        >
          <h2>Заняття</h2>
          <p>
            {gridLessons.person.name} ·{" "}
            {new Date(gridLessons.date + "T00:00:00").toLocaleDateString(
              "uk-UA",
              { day: "numeric", month: "long" },
            )}
          </p>
          <div className="lesson-day">
            <LessonEditor
              lessons={gridLessons.person.lessons[gridLessons.date] ?? []}
              onAdd={(note) =>
                staffAction({
                  kind: "lesson_add",
                  staffId: gridLessons.person.id,
                  date: gridLessons.date,
                  note,
                })
              }
              onUpdateNote={(lessonId, note) =>
                staffAction({ kind: "lesson_note", lessonId, note })
              }
              onRemove={(lessonId) =>
                staffAction({ kind: "lesson_remove", lessonId })
              }
            />
          </div>
        </Modal>
      )}

      {editing && (
        <Modal
          className={"modal rate-modal"}
          onClose={() => setEditing(null)}
        >
            <h2>Редагувати працівника</h2>
            <p>Ім’я, посада, дата народження, ставка та ліміти</p>
            <div className="form-grid">
              <label className="wide-field">
                Ім’я та прізвище
                <input
                  value={editing.name}
                  onChange={(event) =>
                    setEditing({ ...editing, name: event.target.value })
                  }
                />
              </label>
              <label className="wide-field">
                Посада
                <select
                  value={editing.role}
                  onChange={(event) =>
                    setEditing({ ...editing, role: event.target.value })
                  }
                >
                  {(data.jobTitles.includes(editing.role)
                    ? data.jobTitles
                    : [editing.role, ...data.jobTitles]
                  ).map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </select>
              </label>
              <label className="wide-field">
                Тип оплати
                <select
                  value={editing.salaryType}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      salaryType: event.target.value as StaffDraft["salaryType"],
                    })
                  }
                >
                  <option value="monthly">Місячна ставка</option>
                  <option value="daily">Фіксовано за день</option>
                  <option value="lesson">За проведене заняття</option>
                </select>
              </label>
              {editing.salaryType === "monthly" ? (
                <label className="wide-field">
                  Місячна ставка
                  <input
                    type="number"
                    min="0"
                    value={editing.monthlyRate}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        monthlyRate: event.target.value,
                      })
                    }
                  />
                </label>
              ) : editing.salaryType === "lesson" ? (
                <label className="wide-field">
                  Сума за одне заняття
                  <input
                    type="number"
                    min="0"
                    value={editing.lessonRate}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        lessonRate: event.target.value,
                      })
                    }
                  />
                </label>
              ) : (
                <label className="wide-field">
                  Сума за відпрацьований день
                  <input
                    type="number"
                    min="0"
                    value={editing.dailyRate}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        dailyRate: event.target.value,
                      })
                    }
                  />
                </label>
              )}

              <label>
                Дата народження
                <input
                  type="date"
                  value={editing.birthDate}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      birthDate: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Відпустка, днів на рік
                <input
                  type="number"
                  min="0"
                  value={editing.vacationQuota}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      vacationQuota: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Оплачувані вихідні, днів на місяць
                <input
                  type="number"
                  min="0"
                  value={editing.dayOffQuota}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      dayOffQuota: event.target.value,
                    })
                  }
                />
              </label>
            </div>
            <div className="rate-preview">
              Нова ставка:{" "}
              <b>
                {editing.salaryType === "monthly"
                  ? money(Number(editing.monthlyRate) || 0) + " / місяць"
                  : editing.salaryType === "lesson"
                    ? money(Number(editing.lessonRate) || 0) + " / заняття"
                    : money(Number(editing.dailyRate) || 0) + " / день"}
              </b>
            </div>
            <div className="modal-actions">
              <button onClick={() => setEditing(null)}>Скасувати</button>
              <button
                className="primary"
                disabled={!editing.name.trim()}
                onClick={async () => {
                  const response = await fetch("/api/staff?x=1" + branchQuery, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      kind: "update_staff",
                      month,
                      ...editing,
                      // an empty date input means "unknown", not an empty string
                      birthDate: editing.birthDate || null,
                    }),
                  });
                  const next = (await response.json()) as StaffSnapshot;
                  if (next.rows) {
                    setData(next);
                    setSelected(
                      next.rows.find(
                        (person) => person.id === editing.staffId,
                      ) ?? null,
                    );
                    setEditing(null);
                  }
                }}
              >
                Зберегти
              </button>
            </div>
          </Modal>
      )}

      {adding && (
        <Modal
          className={"modal staff-modal"}
          onClose={() => setAdding(false)}
        >
            <h2>Додати працівника</h2>
            <p>Вкажіть посаду та спосіб розрахунку зарплати</p>
            <div className="form-grid">
              <label className="wide-field">
                Ім’я та прізвище
                <input
                  value={newStaff.name}
                  onChange={(event) =>
                    setNewStaff({ ...newStaff, name: event.target.value })
                  }
                />
              </label>
              <label>
                Посада
                <select
                  value={
                    // Посада за замовчуванням може бути відсутня у філії —
                    // тоді беремо першу наявну, щоб поле не лишалось порожнім.
                    data.jobTitles.includes(newStaff.role)
                      ? newStaff.role
                      : (data.jobTitles[0] ?? "")
                  }
                  onChange={(event) =>
                    setNewStaff({ ...newStaff, role: event.target.value })
                  }
                >
                  {data.jobTitles.map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </select>
              </label>
              <label>
                Тип оплати
                <select
                  value={newStaff.salaryType}
                  onChange={(event) =>
                    setNewStaff({
                      ...newStaff,
                      salaryType: event.target
                        .value as NewStaffDraft["salaryType"],
                    })
                  }
                >
                  <option value="monthly">Місячна ставка</option>
                  <option value="daily">Фіксовано за день</option>
                  <option value="lesson">За проведене заняття</option>
                </select>
              </label>
              {newStaff.salaryType === "monthly" ? (
                <label>
                  Місячна ставка
                  <input
                    type="number"
                    value={newStaff.monthlyRate}
                    onChange={(event) =>
                      setNewStaff({
                        ...newStaff,
                        monthlyRate: event.target.value,
                      })
                    }
                  />
                </label>
              ) : newStaff.salaryType === "lesson" ? (
                <label>
                  Сума за заняття
                  <input
                    type="number"
                    value={newStaff.lessonRate}
                    onChange={(event) =>
                      setNewStaff({
                        ...newStaff,
                        lessonRate: event.target.value,
                      })
                    }
                  />
                </label>
              ) : (
                <label>
                  Сума за день
                  <input
                    type="number"
                    value={newStaff.dailyRate}
                    onChange={(event) =>
                      setNewStaff({
                        ...newStaff,
                        dailyRate: event.target.value,
                      })
                    }
                  />
                </label>
              )}
              <label>
                Дата народження
                <input
                  type="date"
                  value={newStaff.birthDate}
                  onChange={(event) =>
                    setNewStaff({ ...newStaff, birthDate: event.target.value })
                  }
                />
              </label>
              <label>
                Відпустка, днів на рік
                <input
                  type="number"
                  min="0"
                  value={newStaff.vacationQuota}
                  onChange={(event) =>
                    setNewStaff({
                      ...newStaff,
                      vacationQuota: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Оплачувані вихідні, днів на місяць
                <input
                  type="number"
                  min="0"
                  value={newStaff.dayOffQuota}
                  onChange={(event) =>
                    setNewStaff({ ...newStaff, dayOffQuota: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="modal-actions">
              <button onClick={() => setAdding(false)}>Скасувати</button>
              <button
                className="primary"
                disabled={!newStaff.name.trim()}
                onClick={async () => {
                  const response = await fetch("/api/staff?x=1" + branchQuery, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      kind: "staff",
                      month,
                      branch,
                      ...newStaff,
                      // Те саме вирівнювання, що й у полі: інакше на сервер
                      // пішла б посада, якої у філії немає.
                      role: data.jobTitles.includes(newStaff.role)
                        ? newStaff.role
                        : (data.jobTitles[0] ?? newStaff.role),
                      birthDate: newStaff.birthDate || null,
                    }),
                  });
                  const next = (await response.json()) as StaffSnapshot;
                  if (next.rows) {
                    setData(next);
                    setAdding(false);
                    setNewStaff({ ...newStaff, name: "", birthDate: "" });
                  }
                }}
              >
                Додати працівника
              </button>
            </div>
          </Modal>
      )}
    </main>
  );
}
