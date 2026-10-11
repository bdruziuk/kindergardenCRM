"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { MonthPicker } from "@/components/MonthPicker";
import type {
  BirthdayCalendarDto,
  BirthdayPartyDto,
} from "@/lib/api-schemas";
import { dayLabel } from "@/lib/format";
import { currentMonth, monthInfo, monthLabel } from "@/lib/period";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const DURATIONS = [30, 45, 60, 90, 120, 180];

/** «11:00–12:30» з початку й тривалості. */
function timeRange(start: string, minutes: number) {
  const [h, m] = start.split(":").map(Number);
  const end = h * 60 + m + minutes;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${start}–${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`;
}

const durationLabel = (minutes: number) =>
  minutes % 60 === 0
    ? `${minutes / 60} год`
    : minutes > 60
      ? `${Math.floor(minutes / 60)} год ${minutes % 60} хв`
      : `${minutes} хв`;

type Draft = {
  id: number | null;
  childId: string;
  date: string;
  startTime: string;
  durationMinutes: string;
  note: string;
};

const EMPTY: BirthdayCalendarDto = {
  month: "",
  birthdays: [],
  parties: [],
  children: [],
};

/**
 * Календар днів народження філії: хто святкує в цьому місяці й які свята вже
 * заплановані — о котрій і скільки триватимуть.
 *
 * Свято — окремий запис на кожну дитину: якщо в один день іменинників
 * кілька, у кожного своє свято зі своїм часом. Планує власник або керуючий;
 * вихователь бачить календар без кнопок.
 *
 * Місяць тут свій, а не спільний зі сторінками обліку: гортати дні
 * народження наперед не має перемикати оплати й табель.
 */
export function BirthdayCalendar({
  branchQuery,
  canManage,
}: {
  branchQuery: string;
  canManage: boolean;
}) {
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<BirthdayCalendarDto>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Лише відповідь на останній запит — як на сторінках обліку.
  const latest = useRef(0);
  const load = useCallback(() => {
    const ticket = ++latest.current;
    fetch(`/api/birthdays?month=${month}${branchQuery}`)
      .then((response) => response.json())
      .then((next: BirthdayCalendarDto) => {
        if (ticket !== latest.current) return;
        if (next.error) setError(next.error);
        else {
          setData(next);
          setError(null);
        }
      })
      .catch(() => setError("Немає зв’язку із сервером"));
  }, [month, branchQuery]);

  useEffect(() => {
    load();
  }, [load]);

  const info = monthInfo(month);
  const lead = (new Date(info.calendar[0].date + "T00:00:00Z").getUTCDay() + 6) % 7;
  const today = new Date().toISOString().slice(0, 10);
  const birthdaysOn = (date: string, source = data) =>
    source.birthdays.filter((item) => item.date === date);
  const partiesOn = (date: string, source = data) =>
    source.parties.filter((item) => item.date === date);

  /** `source` — знімок, з якого брати свята: після збереження це вже новий,
   *  а не той, що ще лежить у стані. */
  const newDraft = (date: string, source = data): Draft => {
    // Якщо цього дня є іменинник без свята — пропонуємо саме його.
    const free = birthdaysOn(date, source).find(
      (kid) =>
        !partiesOn(date, source).some((party) => party.childId === kid.childId),
    );
    return {
      id: null,
      childId: free ? String(free.childId) : "",
      date,
      startTime: "11:00",
      durationMinutes: "60",
      note: "",
    };
  };

  const openDay = (date: string) => {
    setOpenDate(date);
    setFormError(null);
    setDraft(canManage ? newDraft(date) : null);
  };

  const editParty = (party: BirthdayPartyDto) => {
    setFormError(null);
    setDraft({
      id: party.id,
      childId: String(party.childId),
      date: party.date,
      startTime: party.startTime,
      durationMinutes: String(party.durationMinutes),
      note: party.note,
    });
  };

  const send = async (body: Record<string, unknown>) => {
    setSaving(true);
    setFormError(null);
    const response = await fetch(`/api/birthdays?month=${month}${branchQuery}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const next = (await response?.json().catch(() => null)) as BirthdayCalendarDto | null;
    setSaving(false);
    if (!response?.ok || !next || next.error) {
      setFormError(next?.error ?? "Немає зв’язку із сервером");
      return null;
    }
    setData(next);
    return next;
  };

  const saveDraft = async () => {
    if (!draft) return;
    const ok = await send({
      kind: draft.id ? "party_update" : "party_add",
      ...(draft.id ? { partyId: draft.id } : {}),
      childId: Number(draft.childId),
      date: draft.date,
      startTime: draft.startTime,
      durationMinutes: Number(draft.durationMinutes),
      note: draft.note,
    });
    // Свято могли перенести на інший день — тоді й вікно переходить туди.
    if (ok && openDate) {
      const shown = draft.date.slice(0, 7) === month ? draft.date : openDate;
      setOpenDate(shown);
      setDraft(newDraft(shown, ok));
    }
  };

  return (
    <article className="panel birthday-calendar">
      <div className="payment-toolbar">
        <div>
          <h2>
            Дні народження <span>{data.birthdays.length}</span>
          </h2>
          <p>
            {data.parties.length
              ? `Заплановано свят: ${data.parties.length}`
              : "Свят цього місяця ще не заплановано"}
          </p>
        </div>
        <MonthPicker month={month} onChange={setMonth} />
      </div>

      {error && <div className="empty">{error}</div>}

      <div className="bday-weekdays" aria-hidden="true">
        {WEEKDAYS.map((name) => (
          <b key={name}>{name}</b>
        ))}
      </div>
      <div className="bday-grid">
        {Array.from({ length: lead }, (_, index) => (
          <i className="bday-spacer" key={"s" + index} />
        ))}
        {info.calendar.map((day) => {
          const kids = birthdaysOn(day.date);
          const parties = partiesOn(day.date);
          const label = [
            dayLabel(day.date),
            kids.length ? `іменинників: ${kids.length}` : "",
            parties.length ? `свят: ${parties.length}` : "",
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <button
              type="button"
              key={day.date}
              aria-label={label}
              className={
                "bday-day" +
                (day.weekend ? " weekend" : "") +
                (kids.length ? " has-birthday" : "") +
                (day.date === today ? " today" : "")
              }
              onClick={() => openDay(day.date)}
            >
              <span className="bday-num">{day.day}</span>
              {/* Повне ім'я, обрізане трикрапкою: порядок «ім'я прізвище» у
                  записах різний, тож коротке ім'я не вгадати. */}
              {kids.map((kid) => (
                <span className="bday-kid" key={kid.childId}>
                  🎂 {kid.name}
                </span>
              ))}
              {parties.map((party) => (
                <span className="bday-party" key={party.id}>
                  {party.startTime} {party.childName}
                </span>
              ))}
              {/* На телефоні в клітинку вміщаються лише позначки. */}
              {(kids.length > 0 || parties.length > 0) && (
                <span className="bday-dots" aria-hidden="true">
                  {kids.length > 0 && <i className="dot-birthday" />}
                  {parties.length > 0 && <i className="dot-party" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {openDate && (
        <Modal
          className="modal bday-modal"
          onClose={() => {
            setOpenDate(null);
            setDraft(null);
          }}
        >
          <h2>{dayLabel(openDate)}</h2>
          <p>{monthLabel(openDate.slice(0, 7))}</p>

          <div className="bday-section">
            <h3>Іменинники</h3>
            {birthdaysOn(openDate).length ? (
              birthdaysOn(openDate).map((kid) => (
                <div className="bday-row" key={kid.childId}>
                  <span>🎂</span>
                  <div>
                    <b>{kid.name}</b>
                    <small>
                      {kid.turns !== null ? `виповнюється ${kid.turns}` : ""}
                      {kid.groupName ? ` · група «${kid.groupName}»` : ""}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <p className="bday-empty">Цього дня іменинників немає.</p>
            )}
          </div>

          <div className="bday-section">
            <h3>Заплановані свята</h3>
            {partiesOn(openDate).length ? (
              partiesOn(openDate).map((party) => (
                <div className="bday-row" key={party.id}>
                  <span>🎉</span>
                  <div>
                    <b>
                      {timeRange(party.startTime, party.durationMinutes)} ·{" "}
                      {party.childName}
                    </b>
                    <small>
                      {durationLabel(party.durationMinutes)}
                      {party.note ? ` · ${party.note}` : ""}
                    </small>
                  </div>
                  {canManage && (
                    <div className="bday-actions">
                      <button
                        className="row-action"
                        aria-label={`Змінити свято: ${party.childName}`}
                        onClick={() => editParty(party)}
                      >
                        ✎
                      </button>
                      <button
                        className="remove-relative"
                        aria-label={`Видалити свято: ${party.childName}`}
                        disabled={saving}
                        onClick={async () => {
                          const next = await send({
                            kind: "party_remove",
                            partyId: party.id,
                          });
                          // Звільнений іменинник знову стає першим кандидатом,
                          // якщо зараз заповнюють нове свято, а не правлять інше.
                          if (next && !draft?.id)
                            setDraft(newDraft(openDate, next));
                        }}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="bday-empty">Свят на цей день ще немає.</p>
            )}
          </div>

          {canManage && draft && (
            <div className="bday-section">
              <h3>{draft.id ? "Змінити свято" : "Запланувати свято"}</h3>
              {formError && <p className="modal-error">{formError}</p>}
              <div className="form-grid">
                <label className="wide-field">
                  Дитина
                  <select
                    value={draft.childId}
                    onChange={(event) =>
                      setDraft({ ...draft, childId: event.target.value })
                    }
                  >
                    <option value="">Оберіть дитину</option>
                    {data.children.map((child) => (
                      <option key={child.id} value={child.id}>
                        {child.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Дата
                  <input
                    type="date"
                    value={draft.date}
                    onChange={(event) =>
                      setDraft({ ...draft, date: event.target.value })
                    }
                  />
                </label>
                <label>
                  Початок
                  <input
                    type="time"
                    step={300}
                    value={draft.startTime}
                    onChange={(event) =>
                      setDraft({ ...draft, startTime: event.target.value })
                    }
                  />
                </label>
                <label>
                  Тривалість
                  <select
                    value={draft.durationMinutes}
                    onChange={(event) =>
                      setDraft({ ...draft, durationMinutes: event.target.value })
                    }
                  >
                    {(DURATIONS.includes(Number(draft.durationMinutes))
                      ? DURATIONS
                      : [...DURATIONS, Number(draft.durationMinutes)].sort((a, b) => a - b)
                    ).map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {durationLabel(minutes)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Примітка
                  <input
                    value={draft.note}
                    maxLength={200}
                    placeholder="Необов’язково"
                    onChange={(event) =>
                      setDraft({ ...draft, note: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="modal-actions">
                {draft.id && (
                  <button onClick={() => setDraft(newDraft(openDate))}>
                    Скасувати правку
                  </button>
                )}
                <button
                  className="primary"
                  disabled={saving || !draft.childId || !draft.date || !draft.startTime}
                  onClick={saveDraft}
                >
                  {saving
                    ? "Збереження…"
                    : draft.id
                      ? "Зберегти свято"
                      : "Додати свято"}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </article>
  );
}
