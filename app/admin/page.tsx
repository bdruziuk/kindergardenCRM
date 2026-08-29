"use client";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import type { AdminKindergartenDto, AdminSnapshot } from "@/lib/api-schemas";
import { USER_ROLE_LABELS, dayLabel, initialsOf } from "@/lib/format";

const EMPTY: AdminSnapshot = {
  kindergartens: [],
  totals: { kindergartens: 0, branches: 0, groups: 0, children: 0 },
};

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
          <div className="garden-body">
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
                </div>
              ))}
              {!garden.branches.length && (
                <p className="garden-empty">Філій ще немає.</p>
              )}
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
