"use client";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import type { AdminKindergartenDto, AdminSnapshot } from "@/lib/api-schemas";
import { USER_ROLE_LABELS, dayLabel, initialsOf, plural } from "@/lib/format";

const EMPTY: AdminSnapshot = {
  kindergartens: [],
  totals: { kindergartens: 0, branches: 0, groups: 0, children: 0 },
};

/** Перелік того, що зникне разом із записом — у називному, через кому. */
const damage = (parts: [number, string, string, string][]) =>
  parts
    .filter(([count]) => count > 0)
    .map(([count, one, few, many]) => `${count} ${plural(count, one, few, many)}`)
    .join(", ");

const INVITE_STATUS_LABELS = {
  waiting: "Чекає",
  expired: "Прострочене",
  accepted: "Прийняте",
} as const;

export default function AdminPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<AdminSnapshot>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  /** Пошта та термін запрошення — окремі для кожного садочка. */
  const [invite, setInvite] = useState<Record<number, string>>({});
  const [days, setDays] = useState<Record<number, string>>({});
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Що саме зараз чекає підтвердження видалення — дія незворотна, тож у два
   *  кроки, а не одним кліком по хрестику. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [branchDraft, setBranchDraft] = useState<
    Record<number, { name: string; address: string; fee: string }>
  >({});
  const [renaming, setRenaming] = useState<Record<number, string>>({});
  /** Назва садочка, передрукована для підтвердження. Видалення зносить дітей,
   *  персонал і гроші, тож одного кліку по кнопці для нього замало. */
  const [typed, setTyped] = useState("");

  const draftOf = (id: number) =>
    branchDraft[id] ?? { name: "", address: "", fee: "0" };
  const setDraft = (id: number, patch: Partial<{ name: string; address: string; fee: string }>) =>
    setBranchDraft({ ...branchDraft, [id]: { ...draftOf(id), ...patch } });

  const load = () =>
    fetch("/api/admin")
      .then((response) => response.json())
      .then((next: AdminSnapshot) =>
        next.error ? setError(next.error) : (setData(next), setError(null)),
      )
      .catch(() => setError("Немає зв’язку із сервером"));

  useEffect(() => {
    load();
  }, []);

  const send = async (slot: string, body: Record<string, unknown>) => {
    setBusy(slot);
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const next = (await response.json()) as AdminSnapshot;
    setBusy(null);
    if (next.error) {
      setError(next.error);
      return null;
    }
    setData(next);
    setError(null);
    return next;
  };

  const card = (garden: AdminKindergartenDto) => {
    const expanded = open === garden.id;
    return (
      <article className="garden-card" key={garden.id}>
        <button
          className="garden-head"
          aria-expanded={expanded}
          onClick={() => setOpen(expanded ? null : garden.id)}
        >
          <i>{initialsOf(garden.name)}</i>
          <div>
            <b>{garden.name}</b>
            <small>Зареєстрований {dayLabel(garden.createdAt)}</small>
          </div>
          <div className="garden-counts">
            <span>
              <b>{garden.totals.branches}</b>філій
            </span>
            <span>
              <b>{garden.totals.groups}</b>груп
            </span>
            <span>
              <b>{garden.totals.children}</b>дітей
            </span>
            <span>
              <b>{garden.totals.people}</b>людей
            </span>
          </div>
          <em>{expanded ? "▴" : "▾"}</em>
        </button>

        {expanded && (
          <div className="garden-danger">
            {confirming === `garden-${garden.id}` ? (
              <div className="danger-confirm-box">
                <b>
                  Разом із садочком назавжди зникне:{" "}
                  {damage([
                    [garden.totals.branches, "філія", "філії", "філій"],
                    [garden.totals.groups, "група", "групи", "груп"],
                    [garden.totals.children, "дитина", "дитини", "дітей"],
                    [
                      garden.totals.staff,
                      "працівник",
                      "працівники",
                      "працівників",
                    ],
                    [
                      garden.totals.people,
                      "обліковий запис",
                      "облікові записи",
                      "облікових записів",
                    ],
                  ]) || "нічого — садочок порожній"}
                  . Разом з оплатами, табелем і чергою. Дію не скасувати.
                </b>
                <div>
                  <input
                    value={typed}
                    placeholder={`Введіть «${garden.name}» для підтвердження`}
                    onChange={(event) => setTyped(event.target.value)}
                  />
                  <button
                    className="danger-confirm"
                    disabled={
                      busy === `del-garden-${garden.id}` ||
                      typed.trim() !== garden.name
                    }
                    onClick={async () => {
                      await send(`del-garden-${garden.id}`, {
                        kind: "kindergarten_delete",
                        kindergartenId: garden.id,
                      });
                      setConfirming(null);
                      setTyped("");
                    }}
                  >
                    {busy === `del-garden-${garden.id}`
                      ? "Видаляємо…"
                      : "Видалити назавжди"}
                  </button>
                  <button
                    onClick={() => {
                      setConfirming(null);
                      setTyped("");
                    }}
                  >
                    Скасувати
                  </button>
                </div>
              </div>
            ) : (
              <>
                <span>
                  Видалення зносить садочок разом з усіма філіями, дітьми,
                  персоналом і обліковими записами.
                </span>
                <button
                  className="danger"
                  onClick={() => {
                    setConfirming(`garden-${garden.id}`);
                    setTyped("");
                  }}
                >
                  Видалити садочок
                </button>
              </>
            )}
          </div>
        )}

        {expanded && (
          <div className="garden-body">
            <div className="garden-section">
              <h3>Назва садочка</h3>
              <div className="garden-invite">
                <input
                  value={renaming[garden.id] ?? garden.name}
                  onChange={(event) =>
                    setRenaming({ ...renaming, [garden.id]: event.target.value })
                  }
                />
                <button
                  className="account-save"
                  disabled={
                    busy === `rename-${garden.id}` ||
                    !(renaming[garden.id] ?? garden.name).trim() ||
                    (renaming[garden.id] ?? garden.name).trim() === garden.name
                  }
                  onClick={async () => {
                    const next = await send(`rename-${garden.id}`, {
                      kind: "kindergarten_rename",
                      kindergartenId: garden.id,
                      name: renaming[garden.id] ?? garden.name,
                    });
                    if (next) {
                      const rest = { ...renaming };
                      delete rest[garden.id];
                      setRenaming(rest);
                    }
                  }}
                >
                  {busy === `rename-${garden.id}`
                    ? "Зберігаємо…"
                    : "Перейменувати"}
                </button>
              </div>
            </div>

            <div className="garden-section">
              <h3>Філії</h3>
              {garden.branches.map((branch) => (
                <div className="garden-row" key={branch.id}>
                  <div>
                    <b>{branch.name}</b>
                    <small>{branch.address || "адресу не вказано"}</small>
                  </div>
                  <span className="garden-pill">{branch.groups} груп</span>
                  <span className="garden-pill">{branch.children} дітей</span>
                  {confirming === `branch-${branch.id}` ? (
                    <>
                      <span className="danger-note">
                        Зникне{" "}
                        {damage([
                          [branch.groups, "група", "групи", "груп"],
                          [
                            branch.childrenTotal,
                            "дитина",
                            "дитини",
                            "дітей",
                          ],
                          [
                            branch.staff,
                            "працівник",
                            "працівники",
                            "працівників",
                          ],
                        ]) || "порожня філія"}
                        .
                      </span>
                      <button
                        className="danger-confirm"
                        disabled={busy === `del-branch-${branch.id}`}
                        onClick={async () => {
                          await send(`del-branch-${branch.id}`, {
                            kind: "branch_delete",
                            branchId: branch.id,
                          });
                          setConfirming(null);
                        }}
                      >
                        {busy === `del-branch-${branch.id}`
                          ? "…"
                          : "Видалити"}
                      </button>
                      <button onClick={() => setConfirming(null)}>×</button>
                    </>
                  ) : (
                    <button
                      className="remove-relative"
                      title="Видалити філію з усіма її записами"
                      aria-label={`Видалити філію ${branch.name}`}
                      onClick={() => setConfirming(`branch-${branch.id}`)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {!garden.branches.length && (
                <p className="garden-empty">Філій ще немає.</p>
              )}

              <div className="garden-invite">
                <input
                  placeholder="Назва нової філії"
                  value={draftOf(garden.id).name}
                  onChange={(event) =>
                    setDraft(garden.id, { name: event.target.value })
                  }
                />
                <input
                  placeholder="Адреса"
                  value={draftOf(garden.id).address}
                  onChange={(event) =>
                    setDraft(garden.id, { address: event.target.value })
                  }
                />
                <input
                  type="number"
                  min="0"
                  title="Базова місячна плата"
                  value={draftOf(garden.id).fee}
                  onChange={(event) =>
                    setDraft(garden.id, { fee: event.target.value })
                  }
                />
                <button
                  className="account-save"
                  disabled={
                    busy === `branch-${garden.id}` ||
                    !draftOf(garden.id).name.trim()
                  }
                  onClick={async () => {
                    const draft = draftOf(garden.id);
                    const next = await send(`branch-${garden.id}`, {
                      kind: "branch_create",
                      kindergartenId: garden.id,
                      name: draft.name,
                      address: draft.address,
                      monthlyFee: Number(draft.fee || "0"),
                    });
                    if (next)
                      setBranchDraft({
                        ...branchDraft,
                        [garden.id]: { name: "", address: "", fee: "0" },
                      });
                  }}
                >
                  {busy === `branch-${garden.id}` ? "Додаємо…" : "Додати філію"}
                </button>
              </div>
            </div>

            <div className="garden-section">
              <h3>Власники та керуючі</h3>
              {[...garden.owners, ...garden.managers].map((person) => (
                <div className="garden-row" key={person.id}>
                  <div>
                    <b>{person.name || person.email}</b>
                    <small>
                      {person.name ? `${person.email} · ` : ""}
                      {USER_ROLE_LABELS[person.role]}
                      {person.branchName ? ` · ${person.branchName}` : ""}
                    </small>
                  </div>
                </div>
              ))}
              {!garden.owners.length && !garden.managers.length && (
                <p className="garden-empty">
                  Нікого немає — надішліть запрошення власнику.
                </p>
              )}
            </div>

            <div className="garden-section">
              <h3>Запрошення власника</h3>
              <div className="garden-invite">
                <input
                  type="email"
                  placeholder="owner@example.com"
                  value={invite[garden.id] ?? ""}
                  onChange={(event) =>
                    setInvite({ ...invite, [garden.id]: event.target.value })
                  }
                />
                <input
                  type="number"
                  min="1"
                  max="30"
                  title="Термін дії, днів"
                  value={days[garden.id] ?? "7"}
                  onChange={(event) =>
                    setDays({ ...days, [garden.id]: event.target.value })
                  }
                />
                <button
                  className="account-save"
                  disabled={
                    busy === `invite-${garden.id}` ||
                    !(invite[garden.id] ?? "").trim()
                  }
                  onClick={async () => {
                    const next = await send(`invite-${garden.id}`, {
                      kind: "owner_invite",
                      kindergartenId: garden.id,
                      email: invite[garden.id],
                      days: Number(days[garden.id] ?? "7"),
                    });
                    if (!next) return;
                    setLink(next.newInviteUrl ?? null);
                    setCopied(false);
                    setInvite({ ...invite, [garden.id]: "" });
                  }}
                >
                  {busy === `invite-${garden.id}`
                    ? "Створюємо…"
                    : "Створити посилання"}
                </button>
              </div>

              {garden.invites.map((row) => (
                <div className="garden-row" key={row.id}>
                  <div>
                    <b>{row.email}</b>
                    <small>до {dayLabel(row.expiresAt.slice(0, 10))}</small>
                  </div>
                  <em className="invite-status" data-status={row.status}>
                    {INVITE_STATUS_LABELS[row.status]}
                  </em>
                  {row.status !== "accepted" && (
                    <button
                      className="remove-relative"
                      aria-label={`Скасувати запрошення для ${row.email}`}
                      onClick={() =>
                        send(`revoke-${row.id}`, {
                          kind: "admin_invite_revoke",
                          inviteId: row.id,
                        })
                      }
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {!garden.invites.length && (
                <p className="garden-empty">Запрошень власника ще не було.</p>
              )}
            </div>
          </div>
        )}
      </article>
    );
  };

  return (
    <main className="admin-shell">
      <header className="admin-top">
        <div className="login-brand">
          <b>М</b>
          <span>Малеча</span>
        </div>
        <div>
          <p className="eyebrow">КАБІНЕТ</p>
          <h1>Реєстр садочків</h1>
        </div>
        <div className="admin-who">
          <b>{session?.user?.name || session?.user?.email || "—"}</b>
          <small>Супер-адміністратор</small>
        </div>
        <button
          className="sign-out"
          onClick={() => signOut({ callbackUrl: "/login" })}
          title="Вийти"
          aria-label="Вийти"
        >
          ⏻
        </button>
      </header>

      {error && <div className="empty">{error}</div>}

      <div className="admin-totals">
        <article>
          <span>Садочків</span>
          <b>{data.totals.kindergartens}</b>
        </article>
        <article>
          <span>Філій</span>
          <b>{data.totals.branches}</b>
        </article>
        <article>
          <span>Груп</span>
          <b>{data.totals.groups}</b>
        </article>
        <article>
          <span>Дітей</span>
          <b>{data.totals.children}</b>
        </article>
      </div>

      {link && (
        <div className="invite-link">
          <div>
            <b>Посилання для реєстрації власника</b>
            <small>
              Показуємо один раз: у базі лише його хеш, відновити потім
              нізвідки.
            </small>
            <code>{link}</code>
          </div>
          <button
            className="account-save ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "✓ Скопійовано" : "Скопіювати"}
          </button>
        </div>
      )}

      <div className="admin-new">
        <input
          value={newName}
          placeholder="Назва нового садочка"
          onChange={(event) => setNewName(event.target.value)}
        />
        <button
          className="account-save"
          disabled={busy === "create" || !newName.trim()}
          onClick={async () => {
            const next = await send("create", {
              kind: "kindergarten_create",
              name: newName,
            });
            if (next) setNewName("");
          }}
        >
          {busy === "create" ? "Створюємо…" : "Зареєструвати садочок"}
        </button>
      </div>

      <div className="garden-list">{data.kindergartens.map(card)}</div>

      {!data.kindergartens.length && (
        <div className="empty">Садочків ще немає.</div>
      )}
    </main>
  );
}
