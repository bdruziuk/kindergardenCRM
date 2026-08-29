"use client";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { BranchPicker, useBranch } from "@/components/BranchPicker";
import { Sidebar } from "@/components/Sidebar";
import {
  type ChildDto,
  type GroupDto,
  type GroupStaffDto,
  type RelativeDto,
  childStatusValues,
} from "@/lib/api-schemas";
import { CHILD_STATUS_LABELS, dayLabel } from "@/lib/format";

type ChildStatus = ChildDto["status"];

type EditDraft = {
  id: number;
  fullName: string;
  birthDate: string;
  groupName: string;
  fee: string;
  status: ChildStatus;
  enrolledAt: string;
  leftAt: string;
  relatives: RelativeDto[];
};

const STATUS_HINTS: Record<ChildStatus, string> = {
  active: "Дитина відвідує садочок",
  paused: "Місце тимчасово призупинено",
  left: "Дитина більше не відвідує садочок",
};

export default function Page() {
  const { scope, branchId, choose, branchQuery, branchName } =
    useBranch();
  const branch = branchName;
  const [group, setGroup] = useState("Усі групи"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<ChildDto | null>(null),
    [add, setAdd] = useState(false),
    [groupList, setGroupList] = useState<GroupDto[]>([]),
    [groupDraft, setGroupDraft] = useState<{
      id: number | null;
      name: string;
      age: string;
      /** Кого закріплено за групою — редагується тут же, разом із назвою. */
      staffIds: number[];
    } | null>(null),
    [staffList, setStaffList] = useState<GroupStaffDto[]>([]),
    [kidsList, setKidsList] = useState<ChildDto[]>([]),
    [branchFee, setBranchFee] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [newKid, setNewKid] = useState({
      name: "",
      group: "",
      birthDate: "",
      // Порожнє, поки не завантажилась філія: підставляти вигадане число, яке
      // потім розійдеться з платою філії, гірше, ніж не підставляти нічого.
      fee: "",
      // Дитину зараховують сьогодні, поки не сказано інакше — щоб у звітах за
      // минулі місяці вона не з’являлася заднім числом.
      enrolledAt: new Date().toISOString().slice(0, 10),
      relatives: [{ name: "", note: "Мама", phone: "" }] as RelativeDto[],
    }),
    [editing, setEditing] = useState<EditDraft | null>(null);

  /** Applies a snapshot response, or surfaces the error it carries instead. */
  const apply = (data: {
    groups?: GroupDto[];
    children?: ChildDto[];
    monthlyFee?: number;
    staff?: GroupStaffDto[];
    error?: string;
  }) => {
    if (!data.groups || !data.children) {
      setError(data.error ?? "Не вдалося завантажити дані");
      return false;
    }
    setGroupList(data.groups);
    setKidsList(data.children);
    setBranchFee(data.monthlyFee ?? 0);
    setStaffList(data.staff ?? []);
    setError(null);
    return true;
  };

  useEffect(() => {
    fetch("/api/kindergarten?x=1" + branchQuery)
      .then((r) => r.json())
      .then(apply)
      .catch(() => setError("Немає зв’язку із сервером"))
      .finally(() => setLoading(false));
  }, [branchQuery]);

  const shown = useMemo(
    () =>
      kidsList.filter(
        (child) =>
          (group === "Усі групи" || child.groupName === group) &&
          child.fullName.toLowerCase().includes(query.toLowerCase()),
      ),
    [group, query, kidsList],
  );
  return (
    <main className="shell">
      <Sidebar active="/children" />
      <section className="work children-page">
        <header>
          <div>
            <p className="eyebrow">ВИХОВАНЦІ</p>
            <h1>Діти та групи</h1>
            <p className="page-sub">
              Керуйте списками дітей, групами та контактами родичів
            </p>
          </div>
          <div className="actions">
            <button className="bell">♢</button>
            <BranchPicker
              scope={scope}
              branchId={branchId}
              onChange={choose}
            />
            <button
              className="primary"
              onClick={() => {
                // Підставляємо плату філії саме тут: до завантаження знімка її
                // ще немає, а на момент відкриття форми вона вже актуальна —
                // зокрема й після перемикання філії.
                setNewKid({ ...newKid, fee: String(branchFee) });
                setAdd(true);
              }}
            >
              ＋ Додати дитину
            </button>
          </div>
        </header>
        <div className="section-heading">
          <div>
            <h2>Групи</h2>
            <span>
              {groupList.length} групи ·{" "}
              {groupList.reduce((sum, g) => sum + g.childCount, 0)} дітей
            </span>
          </div>
          <button
            className="outline"
            onClick={() =>
              setGroupDraft({
                id: null,
                name: "",
                age: "3–4 роки",
                staffIds: [],
              })
            }
          >
            ＋ Створити групу
          </button>
        </div>
        <div className="group-cards">
          {groupList.map((g) => (
            <div className="group-card-slot" key={g.id}>
              <button
                className={"group-card " + g.color}
                onClick={() => setGroup(g.name)}
              >
                <i>{g.icon}</i>
                <div>
                  <h3>{g.name}</h3>
                  <p>{g.ageRange}</p>
                </div>
                <b>
                  {g.childCount}
                  <small> дітей</small>
                </b>
                <span>→</span>
              </button>
              <div className="group-staff">
                {g.staff.length ? (
                  g.staff.map((person) => (
                    <span key={person.id} title={`${person.name} — ${person.role}`}>
                      <b>{person.name}</b>
                      <small>{person.role}</small>
                    </span>
                  ))
                ) : (
                  <span className="group-staff-empty">Нікого не закріплено</span>
                )}
              </div>
              <button
                className="group-edit"
                aria-label={`Змінити групу «${g.name}»`}
                title="Змінити назву та вік"
                onClick={() =>
                  setGroupDraft({
                    id: g.id,
                    name: g.name,
                    age: g.ageRange,
                    staffIds: g.staff.map((person) => person.id),
                  })
                }
              >
                ✎
              </button>
            </div>
          ))}
        </div>
        <article className="panel directory">
          <div className="directory-head">
            <div>
              <h2>
                Усі діти <span>{shown.length}</span>
              </h2>
              <p>Філія «{branch}»</p>
            </div>
            <div className="directory-tools">
              <label className="search">
                ⌕
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Пошук за ім’ям…"
                />
              </label>
              <select value={group} onChange={(e) => setGroup(e.target.value)}>
                <option>Усі групи</option>
                {groupList.map((g) => (
                  <option key={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="scroll">
            <table className="children-table">
              <thead>
                <tr>
                  {[
                    "Дитина",
                    "Група",
                    "Батьки / родичі",
                    "Плата за місяць",
                    "Статус",
                    "",
                  ].map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((child, i) => (
                  <tr key={child.id} onClick={() => setSelected(child)}>
                    <td>
                      <i className={"avatar av" + i}>{child.initials}</i>
                      <div>
                        <b>{child.fullName}</b>
                        <small>{child.ageLabel}</small>
                      </div>
                    </td>
                    <td>
                      <span className="group-pill">{child.groupName}</span>
                    </td>
                    <td>
                      <div className="relative-cell">
                        <b>{child.relatives[0]?.name ?? "Не вказано"}</b>
                        <small>
                          {child.relatives[0]?.note ?? "Родич"} ·{" "}
                          {child.relatives[0]?.phone ?? "—"}
                          {child.relatives.length > 1 &&
                            ` · ще ${child.relatives.length - 1}`}
                        </small>
                      </div>
                    </td>
                    <td>
                      <b>{child.feeLabel}</b>
                      {child.customFee && (
                        <small className="custom-fee">Індивідуальна</small>
                      )}
                    </td>
                    <td>
                      <span
                        className={
                          "child-status " +
                          (child.status === "paused"
                            ? "pause"
                            : child.status === "left"
                              ? "inactive"
                              : "")
                        }
                      >
                        ● {CHILD_STATUS_LABELS[child.status]}
                      </span>
                    </td>
                    <td>
                      <button className="more">•••</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && (
              <div className="empty">
                {loading
                  ? "Завантаження…"
                  : error
                    ? error
                    : "Нічого не знайдено. Змініть пошук або фільтр."}
              </div>
            )}
          </div>
          <div className="directory-foot">
            <span>
              Показано {shown.length} із {kidsList.length} дітей
            </span>
            {shown.length > 30 && (
              <div>
                <button disabled>‹</button>
                <button className="current">1</button>
                <button>2</button>
                <button>3</button>
                <button>›</button>
              </div>
            )}
          </div>
        </article>
      </section>
      {selected && (
        <Modal
          className={"drawer"}
          onClose={() => setSelected(null)}
        >
            <div className="child-hero">
              <i>{selected.initials}</i>
              <h2>{selected.fullName}</h2>
              <p>
                {selected.ageLabel} · група «{selected.groupName}»
              </p>
            </div>
            <div className="detail-block">
              <h3>Основна інформація</h3>
              <p>
                <span>Філія</span>
                <b>{branch}</b>
              </p>
              <p>
                <span>Місячна плата</span>
                <b>{selected.feeLabel}</b>
              </p>
              <p>
                <span>Статус</span>
                <b
                  className={
                    selected.status === "active"
                      ? "green-text"
                      : selected.status === "paused"
                        ? "amber-text"
                        : "muted-text"
                  }
                >
                  ● {CHILD_STATUS_LABELS[selected.status]}
                </b>
              </p>
              <p>
                <span>У садочку</span>
                <b>
                  {selected.enrolledAt
                    ? `з ${dayLabel(selected.enrolledAt)}`
                    : "дата зарахування невідома"}
                  {selected.leftAt ? ` до ${dayLabel(selected.leftAt)}` : ""}
                </b>
              </p>
            </div>
            <div className="detail-block">
              <h3>Батьки та родичі</h3>
              <div className="contact-list">
                {selected.relatives.map((r, i) => (
                  <div className="contact-card" key={i}>
                    <i>
                      {r.name
                        .split(" ")
                        .map((x) => x[0])
                        .slice(0, 2)
                        .join("")}
                    </i>
                    <div>
                      <b>{r.name}</b>
                      <small>
                        {r.note} · {r.phone}
                      </small>
                    </div>
                    <button aria-label={`Зателефонувати ${r.name}`}>☎</button>
                  </div>
                ))}
              </div>
            </div>
            <button
              className="edit-child"
              onClick={() => {
                setEditing({
                  id: selected.id,
                  fullName: selected.fullName,
                  birthDate: selected.birthDate ?? "",
                  groupName: selected.groupName,
                  fee: String(selected.fee),
                  status: selected.status,
                  enrolledAt: selected.enrolledAt ?? "",
                  leftAt: selected.leftAt ?? "",
                  relatives: selected.relatives.map((r) => ({ ...r })),
                });
                setSelected(null);
              }}
            >
              Редагувати дані дитини
            </button>
          </Modal>
      )}
      {editing && (
        <Modal
          className={"modal edit-modal"}
          onClose={() => setEditing(null)}
        >
            <h2>Редагувати дитину</h2>
            <p>Змініть дані, групу або поточний статус</p>
            <div className="form-grid">
              <label>
                Ім’я та прізвище
                <input
                  value={editing.fullName}
                  onChange={(e) =>
                    setEditing({ ...editing, fullName: e.target.value })
                  }
                />
              </label>
              <label>
                Дата народження
                <input
                  type="date"
                  value={editing.birthDate}
                  onChange={(e) =>
                    setEditing({ ...editing, birthDate: e.target.value })
                  }
                />
              </label>
              <label>
                Група
                <select
                  value={editing.groupName}
                  onChange={(e) =>
                    setEditing({ ...editing, groupName: e.target.value })
                  }
                >
                  {groupList.map((g) => (
                    <option key={g.id}>{g.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Місячна плата
                <input
                  type="number"
                  value={editing.fee}
                  onChange={(e) =>
                    setEditing({ ...editing, fee: e.target.value })
                  }
                />
              </label>
              <label className="status-field">
                Статус
                <select
                  value={editing.status}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      status: e.target.value as ChildStatus,
                    })
                  }
                >
                  {childStatusValues.map((status) => (
                    <option key={status} value={status}>
                      {CHILD_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Зарахований з
                <input
                  type="date"
                  value={editing.enrolledAt}
                  onChange={(e) =>
                    setEditing({ ...editing, enrolledAt: e.target.value })
                  }
                />
              </label>
              <label>
                Вибув
                <input
                  type="date"
                  value={editing.leftAt}
                  onChange={(e) =>
                    setEditing({ ...editing, leftAt: e.target.value })
                  }
                />
              </label>
              <div className="relatives-editor">
                <div className="relatives-title">
                  <b>Батьки та родичі</b>
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        ...editing,
                        relatives: [
                          ...editing.relatives,
                          { name: "", note: "Родич", phone: "" },
                        ],
                      })
                    }
                  >
                    ＋ Додати родича
                  </button>
                </div>
                {editing.relatives.map((relative, index) => (
                  <div className="relative-row" key={index}>
                    <label>
                      Ім’я
                      <input
                        value={relative.name}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            relatives: editing.relatives.map(
                              (item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, name: e.target.value }
                                  : item,
                            ),
                          })
                        }
                        placeholder="Ім’я та прізвище"
                      />
                    </label>
                    <label>
                      Нотатка
                      <input
                        value={relative.note}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            relatives: editing.relatives.map(
                              (item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, note: e.target.value }
                                  : item,
                            ),
                          })
                        }
                        placeholder="Мама, тато, бабуся…"
                      />
                    </label>
                    <label>
                      Телефон
                      <input
                        value={relative.phone}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            relatives: editing.relatives.map(
                              (item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, phone: e.target.value }
                                  : item,
                            ),
                          })
                        }
                        placeholder="+380"
                      />
                    </label>
                    <button
                      className="remove-relative"
                      type="button"
                      onClick={() =>
                        setEditing({
                          ...editing,
                          relatives: editing.relatives.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        })
                      }
                      aria-label="Видалити родича"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="status-hint">
              <i
                className={
                  editing.status === "active"
                    ? "green"
                    : editing.status === "paused"
                      ? "yellow"
                      : "gray-dot"
                }
              />
              <span>{STATUS_HINTS[editing.status]}</span>
            </div>
            <div className="modal-actions">
              <button onClick={() => setEditing(null)}>Скасувати</button>
              <button
                className="primary"
                disabled={!editing.fullName.trim() || !editing.groupName}
                onClick={async () => {
                  const r = await fetch("/api/kindergarten?x=1" + branchQuery, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      kind: "update_child",
                      childId: editing.id,
                      child: {
                        fullName: editing.fullName,
                        birthDate: editing.birthDate || null,
                        groupName: editing.groupName,
                        fee: Number(editing.fee || 0),
                        status: editing.status,
                        enrolledAt: editing.enrolledAt || null,
                        leftAt: editing.leftAt || null,
                        relatives: editing.relatives,
                      },
                    }),
                  });
                  if (apply(await r.json())) setEditing(null);
                }}
              >
                Зберегти зміни
              </button>
            </div>
          </Modal>
      )}
      {add && (
        <Modal
          className={"modal"}
          onClose={() => setAdd(false)}
        >
            <h2>Додати дитину</h2>
            <p>Заповніть основні дані нового вихованця</p>
            <div className="form-grid">
              <label>
                Ім’я та прізвище
                <input
                  value={newKid.name}
                  onChange={(e) =>
                    setNewKid({ ...newKid, name: e.target.value })
                  }
                  placeholder="Наприклад, Марта Коваль"
                />
              </label>
              <label>
                Дата народження
                <input
                  type="date"
                  value={newKid.birthDate}
                  onChange={(e) =>
                    setNewKid({ ...newKid, birthDate: e.target.value })
                  }
                />
              </label>
              <label>
                Зарахований з
                <input
                  type="date"
                  value={newKid.enrolledAt}
                  onChange={(e) =>
                    setNewKid({ ...newKid, enrolledAt: e.target.value })
                  }
                />
              </label>
              <label>
                Група
                <select
                  value={newKid.group}
                  onChange={(e) =>
                    setNewKid({ ...newKid, group: e.target.value })
                  }
                >
                  <option value="">Оберіть групу</option>
                  {groupList.map((g) => (
                    <option key={g.id}>{g.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Місячна плата
                <input
                  value={newKid.fee}
                  onChange={(e) =>
                    setNewKid({ ...newKid, fee: e.target.value })
                  }
                  type="number"
                />
              </label>
              <div className="relatives-editor">
                <div className="relatives-title">
                  <b>Батьки та родичі</b>
                  <button
                    type="button"
                    onClick={() =>
                      setNewKid({
                        ...newKid,
                        relatives: [
                          ...newKid.relatives,
                          { name: "", note: "Родич", phone: "" },
                        ],
                      })
                    }
                  >
                    ＋ Додати родича
                  </button>
                </div>
                {newKid.relatives.map((r, i) => (
                  <div className="relative-row" key={i}>
                    <label>
                      Ім’я
                      <input
                        value={r.name}
                        onChange={(e) =>
                          setNewKid({
                            ...newKid,
                            relatives: newKid.relatives.map((x, j) =>
                              j === i ? { ...x, name: e.target.value } : x,
                            ),
                          })
                        }
                        placeholder="Ім’я та прізвище"
                      />
                    </label>
                    <label>
                      Нотатка
                      <input
                        value={r.note}
                        onChange={(e) =>
                          setNewKid({
                            ...newKid,
                            relatives: newKid.relatives.map((x, j) =>
                              j === i ? { ...x, note: e.target.value } : x,
                            ),
                          })
                        }
                        placeholder="Мама, тато, бабуся…"
                      />
                    </label>
                    <label>
                      Телефон
                      <input
                        value={r.phone}
                        onChange={(e) =>
                          setNewKid({
                            ...newKid,
                            relatives: newKid.relatives.map((x, j) =>
                              j === i ? { ...x, phone: e.target.value } : x,
                            ),
                          })
                        }
                        placeholder="+380"
                      />
                    </label>
                    {newKid.relatives.length > 1 && (
                      <button
                        className="remove-relative"
                        type="button"
                        onClick={() =>
                          setNewKid({
                            ...newKid,
                            relatives: newKid.relatives.filter(
                              (_, j) => j !== i,
                            ),
                          })
                        }
                        aria-label="Видалити родича"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-actions">
              <button onClick={() => setAdd(false)}>Скасувати</button>
              <button
                className="primary"
                disabled={!newKid.name.trim() || !newKid.group}
                onClick={async () => {
                  const r = await fetch("/api/kindergarten?x=1" + branchQuery, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      kind: "child",
                      child: {
                        fullName: newKid.name,
                        birthDate: newKid.birthDate || null,
                        groupName: newKid.group,
                        fee: Number(newKid.fee || 0),
                        status: "active",
                        enrolledAt: newKid.enrolledAt || null,
                        leftAt: null,
                        relatives: newKid.relatives.filter((r) =>
                          r.name.trim(),
                        ),
                      },
                    }),
                  });
                  if (apply(await r.json())) {
                    setGroup(newKid.group);
                    setAdd(false);
                    setNewKid({
                      name: "",
                      group: "",
                      birthDate: "",
                      fee: String(branchFee),
                      enrolledAt: new Date().toISOString().slice(0, 10),
                      relatives: [{ name: "", note: "Мама", phone: "" }],
                    });
                  }
                }}
              >
                Додати дитину
              </button>
            </div>
          </Modal>
      )}
      {groupDraft && (
        <Modal
          className={"modal group-modal"}
          onClose={() => setGroupDraft(null)}
        >
          <h2>{groupDraft.id ? "Змінити групу" : "Створити групу"}</h2>
          <p>
            {groupDraft.id
              ? "Назву можна змінити будь-коли — діти прив’язані до групи, а не до її назви"
              : "Додайте назву та вікову категорію нової групи"}
          </p>
          <div className="form-grid">
            <label className="wide-field">
              Назва групи
              <input
                value={groupDraft.name}
                onChange={(e) =>
                  setGroupDraft({ ...groupDraft, name: e.target.value })
                }
                placeholder="Наприклад, Метелик"
              />
            </label>
            <label>
              Вікова категорія
              <select
                value={groupDraft.age}
                onChange={(e) =>
                  setGroupDraft({ ...groupDraft, age: e.target.value })
                }
              >
                <option>2–3 роки</option>
                <option>3–4 роки</option>
                <option>4–5 років</option>
                <option>5–6 років</option>
              </select>
            </label>
            <label>
              Філія
              <select defaultValue={branch}>
                <option>{branch}</option>
              </select>
            </label>
          </div>

          {groupDraft.id !== null && (
            <div className="group-staff-picker">
              <b>Хто закріплений за групою</b>
              <p>
                Посада береться з картки працівника — окремо її тут не
                задають
              </p>
              {staffList.map((person) => {
                const picked = groupDraft.staffIds.includes(person.id);
                return (
                  <label key={person.id}>
                    <input
                      type="checkbox"
                      checked={picked}
                      onChange={() =>
                        setGroupDraft({
                          ...groupDraft,
                          staffIds: picked
                            ? groupDraft.staffIds.filter(
                                (id) => id !== person.id,
                              )
                            : [...groupDraft.staffIds, person.id],
                        })
                      }
                    />
                    <b>{person.name}</b>
                    <small>{person.role}</small>
                  </label>
                );
              })}
              {!staffList.length && (
                <p className="group-staff-none">
                  У філії ще немає працівників — додайте їх у розділі
                  «Колектив».
                </p>
              )}
            </div>
          )}
          <div className="modal-actions">
            <button onClick={() => setGroupDraft(null)}>Скасувати</button>
            <button
              className="primary"
              disabled={!groupDraft.name.trim()}
              onClick={async () => {
                const renamedFrom = groupDraft.id
                  ? groupList.find((g) => g.id === groupDraft.id)?.name
                  : undefined;
                const r = await fetch("/api/kindergarten?x=1" + branchQuery, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(
                    groupDraft.id
                      ? {
                          kind: "update_group",
                          groupId: groupDraft.id,
                          name: groupDraft.name,
                          ageRange: groupDraft.age,
                        }
                      : {
                          kind: "group",
                          name: groupDraft.name,
                          ageRange: groupDraft.age,
                        },
                  ),
                });
                let snapshot = await r.json();
                if (snapshot.groups && groupDraft.id !== null) {
                  const staffResponse = await fetch(
                    "/api/kindergarten?x=1" + branchQuery,
                    {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        kind: "group_staff",
                        groupId: groupDraft.id,
                        staffIds: groupDraft.staffIds,
                      }),
                    },
                  );
                  snapshot = await staffResponse.json();
                }
                if (apply(snapshot)) {
                  // the group filter holds a name, so a rename must follow it
                  if (renamedFrom && group === renamedFrom)
                    setGroup(groupDraft.name.trim());
                  setGroupDraft(null);
                }
              }}
            >
              {groupDraft.id ? "Зберегти" : "Створити групу"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
