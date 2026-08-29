"use client";
import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { Sidebar } from "@/components/Sidebar";
import type { BranchDto, BranchesSnapshot } from "@/lib/api-schemas";
import { moneyLabel } from "@/lib/format";

const EMPTY: BranchesSnapshot = { branches: [], users: [] };

type Draft = {
  id: number | null;
  name: string;
  address: string;
  monthlyFee: string;
};

export default function BranchesPage() {
  const [data, setData] = useState<BranchesSnapshot>(EMPTY);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/branches")
      .then((response) => response.json())
      .then((next: BranchesSnapshot) =>
        next.error ? setError(next.error) : (setData(next), setError(null)),
      )
      .catch(() => setError("Немає зв’язку із сервером"));
  }, []);

  const send = async (body: Record<string, unknown>) => {
    setSaving(true);
    const response = await fetch("/api/branches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const next = (await response.json()) as BranchesSnapshot;
    setSaving(false);
    if (next.error) {
      setError(next.error);
      return false;
    }
    setData(next);
    setError(null);
    return true;
  };

  const openEdit = (branch: BranchDto) =>
    setDraft({
      id: branch.id,
      name: branch.name,
      address: branch.address,
      monthlyFee: String(branch.monthlyFee),
    });

  return (
    <main className="shell">
      <Sidebar active="/branches" />

      <section className="work branches-page">
        <header>
          <div>
            <p className="eyebrow">УПРАВЛІННЯ</p>
            <h1>Філії</h1>
            <p className="page-sub">
              Поки філія одна і ви керуєте нею самі, вибір філії ніде не
              показується — він з’явиться після другої філії або керуючого
            </p>
          </div>
          <div className="actions">
            <button
              className="primary staff-primary"
              onClick={() =>
                setDraft({ id: null, name: "", address: "", monthlyFee: "12500" })
              }
            >
              ＋ Додати філію
            </button>
          </div>
        </header>

        {error && <div className="empty">{error}</div>}

        <div className="branch-cards">
          {data.branches.map((branch) => (
            <article className="panel branch-card" key={branch.id}>
              <div className="branch-head">
                <div>
                  <h2>{branch.name}</h2>
                  <p>{branch.address || "Адресу не вказано"}</p>
                </div>
                <button
                  className="row-action"
                  onClick={() => openEdit(branch)}
                  aria-label={`Змінити філію ${branch.name}`}
                  title="Змінити"
                >
                  ✎
                </button>
              </div>

              <div className="branch-stats">
                <div>
                  <span>Дітей</span>
                  <b>{branch.children}</b>
                </div>
                <div>
                  <span>Колектив</span>
                  <b>{branch.staff}</b>
                </div>
                <div>
                  <span>Базова плата</span>
                  <b>{moneyLabel(branch.monthlyFee)}</b>
                </div>
              </div>

              <div className="branch-managers">
                <span>Керуючі</span>
                {branch.managers.length ? (
                  branch.managers.map((manager) => (
                    <div className="branch-manager" key={manager.id}>
                      <div>
                        <b>{manager.name || manager.email}</b>
                        <small>{manager.email}</small>
                      </div>
                      <button
                        className="remove-relative"
                        disabled={saving}
                        title="Зняти з філії"
                        aria-label={`Зняти ${manager.email} з філії`}
                        onClick={() =>
                          send({
                            kind: "assign",
                            userId: manager.id,
                            branchId: null,
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="lesson-empty">
                    Керуючого немає — філією керує власник.
                  </p>
                )}

                <select
                  value=""
                  disabled={saving}
                  onChange={(event) =>
                    event.target.value &&
                    send({
                      kind: "assign",
                      userId: Number(event.target.value),
                      branchId: branch.id,
                    })
                  }
                >
                  <option value="">＋ Призначити керуючого…</option>
                  {data.users
                    .filter((user) => user.branchId !== branch.id)
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name || user.email}
                      </option>
                    ))}
                </select>
              </div>
            </article>
          ))}
        </div>
      </section>

      {draft && (
        <Modal className="modal" onClose={() => setDraft(null)}>
          <h2>{draft.id ? "Змінити філію" : "Нова філія"}</h2>
          <p>Назва, адреса та базова місячна плата за дитину</p>
          <div className="form-grid">
            <label className="wide-field">
              Назва
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Наприклад, На Лісовій"
              />
            </label>
            <label className="wide-field">
              Адреса
              <input
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                placeholder="Необов’язково"
              />
            </label>
            <label>
              Базова плата
              <input
                type="number"
                min="0"
                value={draft.monthlyFee}
                onChange={(e) =>
                  setDraft({ ...draft, monthlyFee: e.target.value })
                }
              />
            </label>
          </div>
          <div className="modal-actions">
            <button onClick={() => setDraft(null)}>Скасувати</button>
            <button
              className="primary"
              disabled={saving || !draft.name.trim()}
              onClick={async () => {
                const payload = {
                  name: draft.name,
                  address: draft.address,
                  monthlyFee: Number(draft.monthlyFee || 0),
                };
                const ok = await send(
                  draft.id
                    ? { kind: "rename", branchId: draft.id, ...payload }
                    : { kind: "create", ...payload },
                );
                if (ok) setDraft(null);
              }}
            >
              {saving ? "Збереження…" : draft.id ? "Зберегти" : "Створити"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
