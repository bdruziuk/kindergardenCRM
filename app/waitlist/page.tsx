"use client";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { BranchPicker, useBranch } from "@/components/BranchPicker";
import { Sidebar } from "@/components/Sidebar";
import type {
  AgeCategoryDto,
  WaitlistEntryDto,
  WaitlistSnapshot,
  WaitlistStatus,
} from "@/lib/api-schemas";
import { waitlistStatusValues } from "@/lib/api-schemas";
import {
  WAITLIST_STATUS_LABELS,
  initialsOf,
  monthGenitive,
} from "@/lib/format";

const EMPTY: WaitlistSnapshot = {
  rows: [],
  groups: [],
  categories: [],
  summary: { waiting: 0, invited: 0, enrolled: 0, declined: 0, total: 0 },
};

type Draft = {
  id: number | null;
  childName: string;
  childBirthDate: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  preferredGroupId: string;
  desiredFrom: string;
  note: string;
};

/** Заявка разом із її місцем у черзі своєї вікової категорії. */
type QueueEntry = { row: WaitlistEntryDto; position: number };

type CategoryDraft = {
  id: number | null;
  name: string;
  fromYear: string;
  toYear: string;
};

const NO_CATEGORY = "";

/** Категорія, у яку потрапляє дитина за роком народження. Діапазони можуть
 *  перетинатися — тоді виграє перша за порядком, тобто найстарша категорія. */
const categoryOf = (
  categories: AgeCategoryDto[],
  birthDate: string | null,
) => {
  if (!birthDate) return NO_CATEGORY;
  const year = Number(birthDate.slice(0, 4));
  const match = categories.find(
    (category) => year >= category.fromYear && year <= category.toYear,
  );
  return match ? String(match.id) : NO_CATEGORY;
};

const emptyDraft = (): Draft => ({
  id: null,
  childName: "",
  childBirthDate: "",
  parentName: "",
  parentPhone: "",
  parentEmail: "",
  preferredGroupId: "",
  desiredFrom: "",
  note: "",
});

export default function WaitlistPage() {
  const { scope, branchId, choose, branchQuery, branchName } =
    useBranch();
  const branch = branchName;
  const [data, setData] = useState<WaitlistSnapshot>(EMPTY);
  const [filter, setFilter] = useState<"all" | WaitlistStatus>("all");
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/waitlist?x=1" + branchQuery)
      .then((response) => response.json())
      .then((next: WaitlistSnapshot) =>
        next.error ? setError(next.error) : (setData(next), setError(null)),
      )
      .catch(() => setError("Немає зв’язку із сервером"));
  }, [branchQuery]);

  const send = async (body: Record<string, unknown>) => {
    setSaving(true);
    const response = await fetch("/api/waitlist?x=1" + branchQuery, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const next = (await response.json()) as WaitlistSnapshot;
    setSaving(false);
    if (next.error) {
      setError(next.error);
      return false;
    }
    setData(next);
    setError(null);
    return true;
  };

  const shown = useMemo(
    () =>
      data.rows.filter(
        (row) =>
          (filter === "all" || row.status === filter) &&
          (row.childName.toLowerCase().includes(query.toLowerCase()) ||
            row.parentName.toLowerCase().includes(query.toLowerCase()) ||
            row.parentPhone.includes(query)),
      ),
    [data.rows, filter, query],
  );

  /** Місце в черзі своєї категорії. Рахується по всій черзі, а не по
   *  відфільтрованому списку, щоб фільтр за статусом чи пошук не перенумеровував
   *  заявки: третій у черзі лишається третім, хоч би що було на екрані.
   *  `data.rows` приходять від найдавнішої заявки до найновішої. */
  const positions = useMemo(() => {
    const counters = new Map<string, number>();
    const byId = new Map<number, number>();
    for (const row of data.rows) {
      const key = categoryOf(data.categories, row.childBirthDate);
      const position = (counters.get(key) ?? 0) + 1;
      counters.set(key, position);
      byId.set(row.id, position);
    }
    return byId;
  }, [data.rows, data.categories]);

  /** Заявки, згруповані за віковою категорією — в одну групу садочок бере
   *  дітей кількох років народження, тож рік сам по собі нічого не групує.
   *  Категорії йдуть від найстарших дітей до наймолодших, а заявки, чий рік не
   *  потрапив у жодну категорію, — окремим блоком у кінці. Усередині категорії
   *  порядок задає дата подання. */
  const byCategory = useMemo(() => {
    const buckets = new Map<string, QueueEntry[]>();
    // Порожні категорії теж показуємо: інакше щойно створена зникає з очей.
    for (const category of data.categories) buckets.set(String(category.id), []);
    for (const row of shown) {
      const key = categoryOf(data.categories, row.childBirthDate);
      const entry = { row, position: positions.get(row.id) ?? 0 };
      const bucket = buckets.get(key);
      if (bucket) bucket.push(entry);
      else buckets.set(key, [entry]);
    }
    return [...buckets.entries()].map(
      ([key, entries]): [string, QueueEntry[]] => [
        key,
        sort === "asc" ? entries : [...entries].reverse(),
      ],
    );
  }, [shown, data.categories, positions, sort]);

  const categoryTitle = (key: string) => {
    const category = data.categories.find((item) => String(item.id) === key);
    // Поки категорій немає, «поза категоріями» звучало б як помилка — черга
    // просто ще не поділена.
    if (!category)
      return data.categories.length ? "Поза категоріями" : "Уся черга";
    return category.fromYear === category.toYear
      ? `${category.name} · ${category.fromYear}`
      : `${category.name} · ${category.fromYear}–${category.toYear}`;
  };

  const openEdit = (row: WaitlistEntryDto) =>
    setDraft({
      id: row.id,
      childName: row.childName,
      childBirthDate: row.childBirthDate ?? "",
      parentName: row.parentName,
      parentPhone: row.parentPhone,
      parentEmail: row.parentEmail,
      preferredGroupId: row.preferredGroupId ? String(row.preferredGroupId) : "",
      desiredFrom: row.desiredFrom ?? "",
      note: row.note,
    });

  return (
    <main className="shell">
      <Sidebar active="/waitlist" />

      <section className="work waitlist-page">
        <header>
          <div>
            <p className="eyebrow">ВСТУП</p>
            <h1>Черга</h1>
            <p className="page-sub">
              Заявки на місце: дитина, контакти батьків і побажання щодо групи
              та початку
            </p>
          </div>
          <div className="actions">
            <BranchPicker
              scope={scope}
              branchId={branchId}
              onChange={choose}
            />
            <button
              className="outline"
              onClick={() => setCategoriesOpen(true)}
            >
              Вікові категорії
            </button>
            <button
              className="primary staff-primary"
              onClick={() => setDraft(emptyDraft())}
            >
              ＋ Додати заявку
            </button>
          </div>
        </header>

        {error && <div className="empty">{error}</div>}

        <div className="staff-stats">
          <article>
            <i>◷</i>
            <div>
              <span>У черзі</span>
              <b>{data.summary.waiting}</b>
              <small>усього заявок {data.summary.total}</small>
            </div>
          </article>
          <article>
            <i>✉</i>
            <div>
              <span>Запрошено</span>
              <b>{data.summary.invited}</b>
              <small>чекають на відповідь</small>
            </div>
          </article>
          <article className="salary-stat">
            <i>✓</i>
            <div>
              <span>Зараховано</span>
              <b>{data.summary.enrolled}</b>
              <small>із черги</small>
            </div>
          </article>
          <article className="absent-stat">
            <i>×</i>
            <div>
              <span>Відмовились</span>
              <b>{data.summary.declined}</b>
              <small>закриті заявки</small>
            </div>
          </article>
        </div>

        <article className="panel staff-directory">
          <div className="payment-toolbar">
            <div>
              <h2>
                Заявки <span>{shown.length}</span>
              </h2>
              <p>
                Згруповано за віковою категорією, у категорії —{" "}
                {sort === "asc" ? "від найдавніших" : "від найновіших"} заявок ·
                філія «{branch}»
              </p>
            </div>
            <div className="toolbar-right">
              <div className="view-switch">
                {(
                  [
                    ["all", "Усі"],
                    ...waitlistStatusValues.map((status) => [
                      status,
                      WAITLIST_STATUS_LABELS[status],
                    ]),
                  ] as [string, string][]
                ).map(([value, label]) => (
                  <button
                    className={filter === value ? "active" : ""}
                    key={value}
                    onClick={() => setFilter(value as "all" | WaitlistStatus)}
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
                  placeholder="Дитина, батьки або телефон…"
                />
              </label>
            </div>
          </div>
          <div className="scroll">
            <table className="staff-table waitlist-table">
              <thead>
                <tr>
                  <th className="waitlist-rank">№</th>
                  <th>Дитина</th>
                  <th>Контактна особа</th>
                  <th>Побажання</th>
                  <th>
                    <button
                      type="button"
                      className="sort-toggle"
                      aria-pressed={sort === "desc"}
                      title={
                        sort === "asc"
                          ? "Зараз спершу найдавніші заявки"
                          : "Зараз спершу найновіші заявки"
                      }
                      onClick={() =>
                        setSort(sort === "asc" ? "desc" : "asc")
                      }
                    >
                      Подано <span>{sort === "asc" ? "↑" : "↓"}</span>
                    </button>
                  </th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              {byCategory.map(([key, entries]) => (
                <tbody key={key || "none"}>
                  <tr className="waitlist-year">
                    <th colSpan={7} scope="colgroup">
                      {categoryTitle(key)}
                      <span>{entries.length}</span>
                    </th>
                  </tr>
                  {entries.map(({ row, position }) => (
                    <tr key={row.id}>
                      <td className="waitlist-rank">{position}</td>
                      <td>
                        <i className="avatar">{initialsOf(row.childName)}</i>
                        <div>
                          <b>{row.childName}</b>
                          <small>{row.ageLabel}</small>
                        </div>
                      </td>
                      <td>
                        <div className="relative-cell">
                          <b>{row.parentName}</b>
                          <small>
                            {row.parentPhone}
                            {row.parentEmail ? ` · ${row.parentEmail}` : ""}
                          </small>
                        </div>
                      </td>
                      <td>
                        <div className="relative-cell">
                          <b>
                            {row.preferredGroupName || "Будь-яка група"}
                          </b>
                          <small>
                            {row.desiredFrom
                              ? `з ${monthGenitive(row.desiredFrom)}`
                              : "без конкретної дати"}
                            {row.note ? ` · ${row.note}` : ""}
                          </small>
                        </div>
                      </td>
                      <td>
                        {new Date(
                          row.createdAt + "T00:00:00",
                        ).toLocaleDateString("uk-UA")}
                      </td>
                      <td>
                        <select
                          className={"waitlist-status " + row.status}
                          value={row.status}
                          disabled={saving}
                          onChange={(event) =>
                            send({
                              kind: "status",
                              entryId: row.id,
                              status: event.target.value,
                            })
                          }
                        >
                          {waitlistStatusValues.map((status) => (
                            <option key={status} value={status}>
                              {WAITLIST_STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="waitlist-actions">
                        <button
                          className="row-action"
                          onClick={() => openEdit(row)}
                          aria-label={`Змінити заявку ${row.childName}`}
                          title="Змінити"
                        >
                          ✎
                        </button>
                        <button
                          className="remove-relative"
                          disabled={saving}
                          onClick={() =>
                            send({ kind: "remove", entryId: row.id })
                          }
                          aria-label={`Видалити заявку ${row.childName}`}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
            {!shown.length && (
              <div className="empty">
                {data.rows.length
                  ? "За цим фільтром заявок немає."
                  : "Черга порожня. Додайте першу заявку."}
              </div>
            )}
          </div>
        </article>
      </section>

      {draft && (
        <Modal className="modal waitlist-modal" onClose={() => setDraft(null)}>
          <h2>{draft.id ? "Змінити заявку" : "Нова заявка"}</h2>
          <p>Дитина, контактна особа та побажання щодо групи й початку</p>
          <div className="form-grid">
            <label>
              Ім’я дитини
              <input
                value={draft.childName}
                onChange={(e) =>
                  setDraft({ ...draft, childName: e.target.value })
                }
                placeholder="Наприклад, Марта Коваль"
              />
            </label>
            <label>
              Дата народження
              <input
                type="date"
                value={draft.childBirthDate}
                onChange={(e) =>
                  setDraft({ ...draft, childBirthDate: e.target.value })
                }
              />
            </label>
            <label>
              Контактна особа
              <input
                value={draft.parentName}
                onChange={(e) =>
                  setDraft({ ...draft, parentName: e.target.value })
                }
                placeholder="Мама, тато або опікун"
              />
            </label>
            <label>
              Телефон
              <input
                value={draft.parentPhone}
                onChange={(e) =>
                  setDraft({ ...draft, parentPhone: e.target.value })
                }
                placeholder="+380"
              />
            </label>
            <label className="wide-field">
              Пошта
              <input
                type="email"
                value={draft.parentEmail}
                onChange={(e) =>
                  setDraft({ ...draft, parentEmail: e.target.value })
                }
                placeholder="Необов’язково"
              />
            </label>
            <label>
              Бажана група
              <select
                value={draft.preferredGroupId}
                onChange={(e) =>
                  setDraft({ ...draft, preferredGroupId: e.target.value })
                }
              >
                <option value="">Будь-яка</option>
                {data.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Бажаний початок
              <input
                type="month"
                value={draft.desiredFrom}
                onChange={(e) =>
                  setDraft({ ...draft, desiredFrom: e.target.value })
                }
              />
            </label>
            <label className="wide-field">
              Примітка
              <input
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="Наприклад, хочуть з вересня наступного року"
              />
            </label>
          </div>
          <div className="modal-actions">
            <button onClick={() => setDraft(null)}>Скасувати</button>
            <button
              className="primary"
              disabled={
                saving ||
                !draft.childName.trim() ||
                !draft.parentName.trim() ||
                !draft.parentPhone.trim()
              }
              onClick={async () => {
                const payload = {
                  childName: draft.childName,
                  childBirthDate: draft.childBirthDate || null,
                  parentName: draft.parentName,
                  parentPhone: draft.parentPhone,
                  parentEmail: draft.parentEmail,
                  preferredGroupId: draft.preferredGroupId
                    ? Number(draft.preferredGroupId)
                    : null,
                  desiredFrom: draft.desiredFrom || null,
                  note: draft.note,
                };
                const ok = await send(
                  draft.id
                    ? { kind: "update", entryId: draft.id, ...payload }
                    : { kind: "add", ...payload },
                );
                if (ok) setDraft(null);
              }}
            >
              {saving ? "Збереження…" : draft.id ? "Зберегти" : "Додати"}
            </button>
          </div>
        </Modal>
      )}

      {categoriesOpen && (
        <Modal
          className="modal category-modal"
          onClose={() => {
            setCategoriesOpen(false);
            setCategoryDraft(null);
          }}
        >
          <h2>Вікові категорії</h2>
          <p>
            Категорія охоплює кілька років народження — за нею й розбивається
            черга. Роки в різних категоріях краще не перетинати: якщо рік
            підходить двом, дитина потрапляє в старшу.
          </p>

          <div className="category-list">
            {data.categories.map((category) => (
              <div className="category-row" key={category.id}>
                <div>
                  <b>{category.name}</b>
                  <small>
                    {category.fromYear === category.toYear
                      ? `${category.fromYear} рік народження`
                      : `${category.fromYear}–${category.toYear} роки народження`}
                  </small>
                </div>
                <button
                  className="row-action"
                  title="Змінити"
                  aria-label={`Змінити категорію ${category.name}`}
                  onClick={() =>
                    setCategoryDraft({
                      id: category.id,
                      name: category.name,
                      fromYear: String(category.fromYear),
                      toYear: String(category.toYear),
                    })
                  }
                >
                  ✎
                </button>
                <button
                  className="remove-relative"
                  disabled={saving}
                  aria-label={`Видалити категорію ${category.name}`}
                  onClick={() =>
                    send({ kind: "category_remove", categoryId: category.id })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            {!data.categories.length && (
              <div className="empty">
                Категорій ще немає — уся черга показується одним списком.
              </div>
            )}
          </div>

          {categoryDraft ? (
            <>
              <div className="form-grid category-form">
                <label className="wide-field">
                  Назва
                  <input
                    value={categoryDraft.name}
                    onChange={(e) =>
                      setCategoryDraft({
                        ...categoryDraft,
                        name: e.target.value,
                      })
                    }
                    placeholder="Наприклад, Молодша"
                  />
                </label>
                <label>
                  Рік народження з
                  <input
                    type="number"
                    value={categoryDraft.fromYear}
                    onChange={(e) =>
                      setCategoryDraft({
                        ...categoryDraft,
                        fromYear: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  по
                  <input
                    type="number"
                    value={categoryDraft.toYear}
                    onChange={(e) =>
                      setCategoryDraft({
                        ...categoryDraft,
                        toYear: e.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button onClick={() => setCategoryDraft(null)}>
                  Скасувати
                </button>
                <button
                  className="primary"
                  disabled={
                    saving ||
                    !categoryDraft.name.trim() ||
                    !categoryDraft.fromYear ||
                    !categoryDraft.toYear
                  }
                  onClick={async () => {
                    const payload = {
                      name: categoryDraft.name,
                      fromYear: Number(categoryDraft.fromYear),
                      toYear: Number(categoryDraft.toYear),
                    };
                    const ok = await send(
                      categoryDraft.id
                        ? {
                            kind: "category_update",
                            categoryId: categoryDraft.id,
                            ...payload,
                          }
                        : { kind: "category_add", ...payload },
                    );
                    if (ok) setCategoryDraft(null);
                  }}
                >
                  {saving
                    ? "Збереження…"
                    : categoryDraft.id
                      ? "Зберегти"
                      : "Додати"}
                </button>
              </div>
            </>
          ) : (
            <button
              className="add-relative"
              onClick={() => {
                // Типовий садочковий вік — приблизно чотири роки, тож саме цей
                // рік народження й підставляємо як заготовку.
                const guess = String(new Date().getFullYear() - 4);
                setCategoryDraft({
                  id: null,
                  name: "",
                  fromYear: guess,
                  toYear: guess,
                });
              }}
            >
              ＋ Додати категорію
            </button>
          )}
        </Modal>
      )}
    </main>
  );
}
