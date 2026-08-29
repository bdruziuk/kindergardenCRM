"use client";
import { useState } from "react";
import type { LessonDto } from "@/lib/api-schemas";

/**
 * One day's lessons for one teacher. Used both from the timesheet drawer and
 * from a cell of the month grid, so it owns nothing but its draft note.
 */
export function LessonEditor({
  lessons,
  onAdd,
  onUpdateNote,
  onRemove,
}: {
  lessons: LessonDto[];
  onAdd: (note: string) => void;
  onUpdateNote: (id: number, note: string) => void;
  onRemove: (id: number) => void;
}) {
  const [note, setNote] = useState("");

  return (
    <>
      <div className="lesson-list">
        {lessons.map((lesson, index) => (
          <div className="lesson-row" key={lesson.id}>
            <i>{index + 1}</i>
            <input
              defaultValue={lesson.note}
              placeholder="Примітка, напр. група «Сонечко»"
              onBlur={(event) => {
                if (event.target.value.trim() !== lesson.note)
                  onUpdateNote(lesson.id, event.target.value);
              }}
            />
            <button
              className="remove-relative"
              onClick={() => onRemove(lesson.id)}
              aria-label="Видалити заняття"
            >
              ×
            </button>
          </div>
        ))}
        {!lessons.length && (
          <p className="lesson-empty">Занять цього дня ще немає.</p>
        )}
      </div>
      <div className="lesson-add">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Примітка (необов’язково)"
        />
        <button
          className="primary"
          onClick={() => {
            onAdd(note);
            setNote("");
          }}
        >
          ＋ Додати заняття
        </button>
      </div>
    </>
  );
}
