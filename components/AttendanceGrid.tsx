"use client";
import type { CalendarDay, StaffRowDto } from "@/lib/api-schemas";
import {
  ATTENDANCE_KIND_LABELS,
  ATTENDANCE_KIND_MARKS,
  leaveOverrun,
  lessonsLabel,
  paidByLesson,
} from "@/lib/format";

const WEEKDAYS = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

const weekdayOf = (iso: string) =>
  WEEKDAYS[new Date(iso + "T00:00:00Z").getUTCDay()];

/**
 * The whole month at a glance: one row per person, one column per day.
 * Attendance-paid staff cycle worked → absent → unmarked on click; lesson-paid
 * staff open that day's lessons instead, since a cell can hold several.
 */
export function AttendanceGrid({
  rows,
  calendar,
  onCycleAttendance,
  onOpenLessons,
}: {
  rows: StaffRowDto[];
  calendar: CalendarDay[];
  onCycleAttendance: (person: StaffRowDto, date: string) => void;
  onOpenLessons: (person: StaffRowDto, date: string) => void;
}) {
  if (!rows.length)
    return <div className="empty">Колективу за цей місяць немає.</div>;

  return (
    <div className="grid-scroll">
      <table className="attendance-grid-table">
        <thead>
          <tr>
            <th className="grid-name">Працівник</th>
            {calendar.map((day) => (
              <th
                className={day.weekend ? "grid-day weekend" : "grid-day"}
                key={day.date}
                scope="col"
              >
                <b>{day.day}</b>
                <small>{weekdayOf(day.date)}</small>
              </th>
            ))}
            <th className="grid-total">Разом</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((person) => {
            const byLesson = paidByLesson(person.salaryType);
            const overrun = leaveOverrun(person);
            const showLimits =
              !byLesson && (person.vacationQuota > 0 || person.dayOffQuota > 0);
            return (
              <tr key={person.id}>
                <th
                  className={
                    overrun.over ? "grid-name over-limit" : "grid-name"
                  }
                  scope="row"
                >
                  <b>{person.name}</b>
                  <small>{person.role}</small>
                  {showLimits && (
                    <small className="grid-limits">
                      {person.vacationQuota > 0 && (
                        <em
                          className={overrun.vacation ? "over" : undefined}
                          title={`Відпустка: ${person.vacationUsedYear} із ${person.vacationQuota} днів на рік`}
                        >
                          В {person.vacationUsedYear}/{person.vacationQuota}
                        </em>
                      )}
                      {person.dayOffQuota > 0 && (
                        <em
                          className={overrun.dayOff ? "over" : undefined}
                          title={`Оплачувані вихідні: ${person.dayOffDays} із ${person.dayOffQuota} днів на місяць`}
                        >
                          О {person.dayOffDays}/{person.dayOffQuota}
                        </em>
                      )}
                    </small>
                  )}
                </th>

                {calendar.map((day) => {
                  if (byLesson) {
                    const count = (person.lessons[day.date] ?? []).length;
                    return (
                      <td
                        className={day.weekend ? "weekend" : undefined}
                        key={day.date}
                      >
                        <button
                          type="button"
                          className={count ? "cell lessons" : "cell"}
                          onClick={() => onOpenLessons(person, day.date)}
                          title={`${person.name}, ${day.day} — ${
                            count ? lessonsLabel(count) : "додати заняття"
                          }`}
                        >
                          {count || "·"}
                        </button>
                      </td>
                    );
                  }

                  const state = person.marks[day.date];
                  return (
                    <td
                      className={day.weekend ? "weekend" : undefined}
                      key={day.date}
                    >
                      <button
                        type="button"
                        className={
                          "cell " + (state ? state.replace("_", "-") : "blank")
                        }
                        onClick={() => onCycleAttendance(person, day.date)}
                        title={`${person.name}, ${day.day} — ${
                          state
                            ? ATTENDANCE_KIND_LABELS[state].toLowerCase()
                            : "не відмічено"
                        }`}
                      >
                        {state ? ATTENDANCE_KIND_MARKS[state] : "·"}
                      </button>
                    </td>
                  );
                })}

                <td className="grid-total">
                  <b>
                    {byLesson
                      ? `${person.lessonCount} ♪`
                      : `${person.paidDays} опл.`}
                  </b>
                  {!byLesson && (person.vacationDays || person.dayOffDays) ? (
                    <small>
                      {person.workedDays} ✓
                      {person.vacationDays ? ` · ${person.vacationDays} В` : ""}
                      {person.dayOffDays ? ` · ${person.dayOffDays} О` : ""}
                    </small>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
