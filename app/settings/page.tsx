"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Sidebar } from "@/components/Sidebar";
import type {
  AccountDto,
  BranchSettingsDto,
  ColorTheme,
  SettingsSnapshot,
} from "@/lib/api-schemas";
import { colorThemeValues } from "@/lib/api-schemas";
import type { JobTitleDto } from "@/lib/api-schemas";
import {
  SALARY_TYPE_LABELS,
  THEME_LABELS,
  USER_ROLE_LABELS,
  dayLabel,
} from "@/lib/format";

const EMPTY_ACCOUNT: AccountDto = {
  id: 0,
  hasAvatar: false,
  name: "",
  email: "",
  role: "manager",
  branchName: "",
};

const EMPTY: SettingsSnapshot = {
  me: EMPTY_ACCOUNT,
  kindergartenName: "",
  others: [],
  personalTheme: null,
  activeTheme: "green",
  branches: [],
  jobTitles: [],
  invites: [],
};

type BranchDraft = { name: string; address: string };

/** Власник запрошує лише керуючих, тож ролі у формі немає — тільки філія. */
type InviteDraft = {
  email: string;
  branchId: string;
  days: string;
};

const emptyInvite = (): InviteDraft => ({
  email: "",
  branchId: "",
  days: "7",
});

/**
 * Зменшує знімок до квадрата 256 px просто в браузері.
 *
 * Так на сервер їде десяток кілобайт замість фотографії з телефона, і не
 * потрібна бібліотека обробки зображень: аватарка все одно показується
 * розміром із ніготь.
 */
async function toAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Браузер не дав полотна для обробки зображення");

  // Обрізаємо по центру, а не стискаємо: інакше обличчя на широкому кадрі
  // виходило б сплюснутим.
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  bitmap.close();

  const webp = canvas.toDataURL("image/webp", 0.85);
  // Старий браузер міг мовчки віддати PNG замість webp — беремо що вийшло.
  return webp.startsWith("data:image/webp")
    ? webp
    : canvas.toDataURL("image/jpeg", 0.85);
}

const INVITE_STATUS_LABELS = {
  waiting: "Чекає",
  expired: "Прострочене",
  accepted: "Прийняте",
} as const;

export default function SettingsPage() {
  const { update } = useSession();
  const router = useRouter();
  const [data, setData] = useState<SettingsSnapshot>(EMPTY);
  const [names, setNames] = useState<Record<number, string>>({});
  const [drafts, setDrafts] = useState<Record<number, BranchDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [gardenName, setGardenName] = useState("");
  const [invite, setInvite] = useState<InviteDraft>(emptyInvite);
  /** Посилання показується рівно один раз — у базі лише його хеш. */
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  /** Нова посада: окремо для бібліотеки й для кожної філії. */
  const [titleDraft, setTitleDraft] = useState<Record<string, string>>({});
  /** Заготовки, які зараз правлять. Ключ — id посади. */
  const [titleEdits, setTitleEdits] = useState<
    Record<number, Pick<JobTitleDto, "salaryType" | "rate" | "vacationQuota" | "dayOffQuota">>
  >({});

  /** Чернетки полів заводимо від знімка, щоб недописане не зникало. */
  const apply = (next: SettingsSnapshot) => {
    setData(next);
    setNames(
      Object.fromEntries(
        [next.me, ...next.others].map((account) => [account.id, account.name]),
      ),
    );
    setDrafts(
      Object.fromEntries(
        next.branches.map((branch) => [
          branch.id,
          { name: branch.name, address: branch.address },
        ]),
      ),
    );
    setGardenName(next.kindergartenName);
  };

  useEffect(() => {
    fetch("/api/settings")
      .then((response) => response.json())
      .then((next: SettingsSnapshot) =>
        next.error ? setError(next.error) : (apply(next), setError(null)),
      )
      .catch(() => setError("Немає зв’язку із сервером"));
  }, []);

  /** `slot` — що саме зараз зберігається, щоб «Збережено» не спалахувало
   *  одразу на всіх формах сторінки. */
  const send = async (slot: string, body: Record<string, unknown>) => {
    setSaving(slot);
    setSaved(null);
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const next = (await response.json()) as SettingsSnapshot;
    setSaving(null);
    if (next.error) {
      setError(next.error);
      return null;
    }
    apply(next);
    setError(null);
    setSaved(slot);
    return next;
  };

  const createInvite = async () => {
    const next = await send("invite", {
      kind: "invite_create",
      email: invite.email,
      branchId: Number(invite.branchId),
      days: Number(invite.days),
    });
    if (!next) return;
    setInviteLink(next.newInviteUrl ?? null);
    setCopied(false);
    setInvite(emptyInvite());
  };

  const saveName = async (account: AccountDto) => {
    const name = (names[account.id] ?? "").trim();
    const next = await send(`name-${account.id}`, {
      kind: "name",
      userId: account.id,
      name,
    });
    // Ім’я в сайдбарі живе в токені сесії, а не в базі, тож без цього воно
    // оновилося б лише після наступного входу.
    if (next && account.id === next.me.id) await update({ name });
  };

  /** Схему малює серверний layout, тож після зміни його треба перемалювати —
   *  інакше нові кольори з’являться аж на наступному переході. */
  const saveTheme = async (slot: string, body: Record<string, unknown>) => {
    if (await send(slot, body)) router.refresh();
  };

  const draftName = (account: AccountDto) => names[account.id] ?? "";
  const nameUnchanged = (account: AccountDto) =>
    !draftName(account).trim() || draftName(account).trim() === account.name;

  /** Список посад із додаванням і видаленням. `slot` — ключ поля вводу й
   *  ознака, що зараз зберігається: у власника таких списків кілька на
   *  сторінці, і вони не мають блимати всі разом. */
  const titleList = (
    slot: string,
    titles: SettingsSnapshot["jobTitles"],
    branchId: number | null,
    canRemove: (title: SettingsSnapshot["jobTitles"][number]) => boolean,
  ) => (
    <div className="title-block">
      <div className="title-rows">
        {titles.map((title) => {
          const draft = titleEdits[title.id] ?? title;
          const rateLabel =
            draft.salaryType === "monthly"
              ? "Ставка / місяць"
              : draft.salaryType === "daily"
                ? "Ставка / день"
                : "Ставка / заняття";
          const changed =
            draft.salaryType !== title.salaryType ||
            Number(draft.rate) !== title.rate ||
            Number(draft.vacationQuota) !== title.vacationQuota ||
            Number(draft.dayOffQuota) !== title.dayOffQuota;
          const patch = (part: Partial<typeof draft>) =>
            setTitleEdits({
              ...titleEdits,
              [title.id]: { ...draft, ...part },
            });

          return (
            <div className="title-row" key={title.id}>
              <div className="title-head">
                <b>{title.name}</b>
                {canRemove(title) ? (
                  <button
                    type="button"
                    className="title-remove"
                    aria-label={`Прибрати посаду ${title.name}`}
                    disabled={saving === `title-${title.id}`}
                    onClick={() =>
                      send(`title-${title.id}`, {
                        kind: "job_title_remove",
                        titleId: title.id,
                      })
                    }
                  >
                    ×
                  </button>
                ) : (
                  <em title="Посаду додав власник — прибрати може лише він">
                    🔒
                  </em>
                )}
              </div>
              <div className="title-defaults">
                <label>
                  Тип оплати
                  <select
                    value={draft.salaryType}
                    onChange={(event) =>
                      patch({
                        salaryType: event.target
                          .value as JobTitleDto["salaryType"],
                      })
                    }
                  >
                    {(["monthly", "daily", "lesson"] as const).map((type) => (
                      <option key={type} value={type}>
                        {SALARY_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {rateLabel}
                  <input
                    type="number"
                    min="0"
                    value={draft.rate}
                    onChange={(event) =>
                      patch({ rate: Number(event.target.value) })
                    }
                  />
                </label>
                <label>
                  Відпустка, днів/рік
                  <input
                    type="number"
                    min="0"
                    value={draft.vacationQuota}
                    onChange={(event) =>
                      patch({ vacationQuota: Number(event.target.value) })
                    }
                  />
                </label>
                <label>
                  Вихідні, днів/місяць
                  <input
                    type="number"
                    min="0"
                    value={draft.dayOffQuota}
                    onChange={(event) =>
                      patch({ dayOffQuota: Number(event.target.value) })
                    }
                  />
                </label>
                <button
                  className="account-save ghost"
                  disabled={!changed || saving === `defaults-${title.id}`}
                  onClick={async () => {
                    const next = await send(`defaults-${title.id}`, {
                      kind: "job_title_update",
                      titleId: title.id,
                      ...draft,
                    });
                    if (next) {
                      const rest = { ...titleEdits };
                      delete rest[title.id];
                      setTitleEdits(rest);
                    }
                  }}
                >
                  {saving === `defaults-${title.id}` ? "…" : "Зберегти"}
                </button>
              </div>
            </div>
          );
        })}
        {!titles.length && (
          <span className="title-empty">Посад ще немає</span>
        )}
      </div>
      <div className="title-add">
        <input
          value={titleDraft[slot] ?? ""}
          placeholder="Нова посада"
          onChange={(event) =>
            setTitleDraft({ ...titleDraft, [slot]: event.target.value })
          }
        />
        <button
          className="account-save ghost"
          disabled={saving === slot || !(titleDraft[slot] ?? "").trim()}
          onClick={async () => {
            const next = await send(slot, {
              kind: "job_title_add",
              name: titleDraft[slot],
              branchId,
            });
            if (next) setTitleDraft({ ...titleDraft, [slot]: "" });
          }}
        >
          {saving === slot ? "Додаємо…" : "Додати"}
        </button>
      </div>
    </div>
  );

  const swatches = (
    current: ColorTheme | null,
    disabled: boolean,
    onPick: (theme: ColorTheme | null) => void,
  ) => (
    <div className="theme-swatches">
      {colorThemeValues.map((theme) => (
        <button
          key={theme}
          type="button"
          className={"swatch" + (current === theme ? " picked" : "")}
          data-scheme={theme}
          disabled={disabled}
          aria-pressed={current === theme}
          onClick={() => onPick(theme)}
        >
          <i />
          {THEME_LABELS[theme]}
        </button>
      ))}
      <button
        type="button"
        className={"swatch reset" + (current === null ? " picked" : "")}
        disabled={disabled || current === null}
        onClick={() => onPick(null)}
      >
        Типова
      </button>
    </div>
  );

  const me = data.me;
  const branchLabel =
    me.role === "admin" ? "Усі філії" : me.branchName || "Не призначено";

  const branchCard = (branch: BranchSettingsDto) => {
    const draft = drafts[branch.id] ?? { name: branch.name, address: "" };
    const detailsUnchanged =
      !draft.name.trim() ||
      (draft.name.trim() === branch.name &&
        draft.address.trim() === branch.address);

    return (
      <div className="branch-card" key={branch.id}>
        <div className="branch-card-head">
          <b>{branch.name}</b>
          {branch.theme && (
            <em className="theme-chip" data-scheme={branch.theme}>
              {THEME_LABELS[branch.theme]}
            </em>
          )}
        </div>

        <div className="settings-grid">
          <label>
            Назва
            <input
              value={draft.name}
              disabled={!branch.canEditDetails}
              onChange={(event) =>
                setDrafts({
                  ...drafts,
                  [branch.id]: { ...draft, name: event.target.value },
                })
              }
            />
          </label>
          <label>
            Адреса
            <input
              value={draft.address}
              disabled={!branch.canEditDetails}
              placeholder="Вулиця, будинок, місто"
              onChange={(event) =>
                setDrafts({
                  ...drafts,
                  [branch.id]: { ...draft, address: event.target.value },
                })
              }
            />
          </label>
        </div>

        {branch.canEditDetails && (
          <div className="settings-actions">
            {saved === `branch-${branch.id}` && (
              <span className="saved-hint">✓ Збережено</span>
            )}
            <button
              className="account-save ghost"
              disabled={saving === `branch-${branch.id}` || detailsUnchanged}
              onClick={() =>
                send(`branch-${branch.id}`, {
                  kind: "branch_details",
                  branchId: branch.id,
                  name: draft.name,
                  address: draft.address,
                })
              }
            >
              {saving === `branch-${branch.id}`
                ? "Збереження…"
                : "Зберегти філію"}
            </button>
          </div>
        )}

        <div className="theme-block">
          <span className="theme-title">Посади у філії</span>
          {titleList(
            `title-branch-${branch.id}`,
            branch.jobTitles,
            branch.id,
            // Керуючий прибирає лише свої; спущені власником — під замком.
            (title) => me.role === "admin" || !title.addedByOwner,
          )}
          {me.role === "admin" && (
            <button
              className="account-save ghost title-apply"
              disabled={saving === `apply-${branch.id}`}
              onClick={() =>
                send(`apply-${branch.id}`, {
                  kind: "job_titles_apply",
                  branchId: branch.id,
                })
              }
            >
              {saving === `apply-${branch.id}`
                ? "Переносимо…"
                : "Додати посади з бібліотеки"}
            </button>
          )}
          <small>
            {me.role === "admin"
              ? "Ці посади бачить керуючий у випадайці працівників. Перенесення додає з бібліотеки, нічого не затираючи."
              : "Свої посади можна прибирати; ті, що додав власник, — ні."}
          </small>
        </div>

        <div className="theme-block">
          <span className="theme-title">Кольорова схема філії</span>
          {swatches(branch.theme, !branch.canEditTheme, (theme) =>
            saveTheme(`theme-${branch.id}`, {
              kind: "branch_theme",
              branchId: branch.id,
              theme,
            }),
          )}
          <small>
            {!branch.canEditTheme
              ? "Схему встановив власник — змінити її не можна."
              : me.role === "admin"
                ? "Її бачитиме керуючий цієї філії, і змінити сам не зможе. «Типова» знімає обмеження."
                : "Схему видно всім, хто працює в цій філії."}
          </small>
        </div>
      </div>
    );
  };

  return (
    <main className="shell">
      <Sidebar active="/settings" />

      <section className="work settings-page">
        <header>
          <div>
            <p className="eyebrow">ОБЛІКОВИЙ ЗАПИС</p>
            <h1>Налаштування</h1>
            <p className="page-sub">
              ПІБ, кольорова схема інтерфейсу та дані філії
            </p>
          </div>
        </header>

        {error && <div className="empty">{error}</div>}

        <article className="panel settings-panel">
          <div className="profile-hero">
            <Avatar
              userId={me.id}
              name={draftName(me) || me.email || "—"}
              hasAvatar={me.hasAvatar}
              className="avatar-large"
            />
            <div>
              <h2>{draftName(me) || "Без імені"}</h2>
              <p>{me.email || "—"}</p>
              <div className="avatar-actions">
                <label className="avatar-pick">
                  {avatarBusy ? "Завантажуємо…" : "Змінити фото"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={avatarBusy}
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      // Скидаємо одразу, щоб той самий файл можна було
                      // обрати вдруге після невдачі.
                      event.target.value = "";
                      if (!file) return;

                      setAvatarBusy(true);
                      try {
                        const dataUrl = await toAvatarDataUrl(file);
                        const next = await send("avatar", {
                          kind: "avatar_set",
                          dataUrl,
                        });
                        if (next) await update({ hasAvatar: true });
                      } catch {
                        setError("Не вдалося обробити зображення");
                      } finally {
                        setAvatarBusy(false);
                      }
                    }}
                  />
                </label>
                {me.hasAvatar && (
                  <button
                    type="button"
                    className="avatar-clear"
                    disabled={avatarBusy}
                    onClick={async () => {
                      const next = await send("avatar", {
                        kind: "avatar_clear",
                      });
                      if (next) await update({ hasAvatar: false });
                    }}
                  >
                    Прибрати
                  </button>
                )}
              </div>
            </div>
            <em className={"role-badge " + me.role}>
              {USER_ROLE_LABELS[me.role]}
            </em>
          </div>

          <div className="settings-grid">
            <label className="wide-field">
              ПІБ
              <input
                value={draftName(me)}
                onChange={(event) => {
                  setNames({ ...names, [me.id]: event.target.value });
                  if (saved === `name-${me.id}`) setSaved(null);
                }}
                placeholder="Прізвище, ім’я та по батькові"
              />
              <small>Саме це ім’я видно в системі та в бічному меню</small>
            </label>
            <label>
              Пошта
              <input value={me.email} disabled />
              <small>Логін для входу — змінити не можна</small>
            </label>
            <label>
              Пароль
              <button
                type="button"
                className="account-save ghost password-button"
                disabled={saving === "password"}
                onClick={() => send("password", {
                  kind: "password_change_request",
                })}
              >
                {saving === "password"
                  ? "Надсилаємо…"
                  : "Надіслати посилання на зміну"}
              </button>
              <small>
                {data.passwordMail === "sent"
                  ? `Посилання надіслано на ${me.email}. Діє дві години.`
                  : data.passwordMail === "logged"
                    ? "Пошта не налаштована — посилання лишилось у лозі сервера."
                    : "Пароль змінюється за посиланням із листа, не тут"}
              </small>
            </label>
            <label>
              Садочок
              <input
                value={me.role === "admin" ? gardenName : data.kindergartenName || "—"}
                disabled={me.role !== "admin"}
                onChange={(event) => {
                  setGardenName(event.target.value);
                  if (saved === "garden") setSaved(null);
                }}
              />
              <small>
                {me.role === "admin"
                  ? "Назву бачать усі, хто працює в садочку"
                  : "Назву садочка змінює власник"}
              </small>
            </label>
            <label>
              Філія
              <input value={branchLabel} disabled />
              <small>
                {me.role === "admin"
                  ? "Власник не прив’язаний до однієї філії"
                  : "Призначає власник на сторінці «Філії»"}
              </small>
            </label>
          </div>

          <div className="settings-actions">
            {saved === "garden" && (
              <span className="saved-hint">✓ Назву садочка збережено</span>
            )}
            {me.role === "admin" && (
              <button
                className="account-save ghost"
                disabled={
                  saving === "garden" ||
                  !gardenName.trim() ||
                  gardenName.trim() === data.kindergartenName
                }
                onClick={() =>
                  send("garden", {
                    kind: "kindergarten_rename",
                    name: gardenName,
                  })
                }
              >
                {saving === "garden"
                  ? "Збереження…"
                  : "Зберегти назву садочка"}
              </button>
            )}
            {saved === `name-${me.id}` && (
              <span className="saved-hint">✓ Збережено</span>
            )}
            <button
              className="account-save"
              disabled={saving === `name-${me.id}` || nameUnchanged(me)}
              onClick={() => saveName(me)}
            >
              {saving === `name-${me.id}` ? "Збереження…" : "Зберегти"}
            </button>
          </div>

          {me.role === "admin" && (
            <div className="theme-block">
              <span className="theme-title">Моя кольорова схема</span>
              {swatches(data.personalTheme, false, (theme) =>
                saveTheme("theme-personal", { kind: "personal_theme", theme }),
              )}
              <small>
                Стосується лише вашого інтерфейсу й важливіша за схему філії —
                ви ж дивитесь на кілька філій одразу. «Типова» повертає зелену.
              </small>
            </div>
          )}
        </article>

        <article className="panel settings-panel">
          <div className="section-heading">
            <div>
              <h2>{me.role === "admin" ? "Філії" : "Моя філія"}</h2>
              <span>
                {me.role === "admin"
                  ? "Назва, адреса та кольорова схема кожної філії"
                  : "Назву й адресу змінює власник; схему — ви, поки він її не задав"}
              </span>
            </div>
          </div>

          <div className="branch-list">{data.branches.map(branchCard)}</div>

          {!data.branches.length && (
            <div className="empty">
              {me.role === "admin"
                ? "Філій ще немає. Створити їх можна на сторінці «Філії»."
                : "Вам ще не призначено філію."}
            </div>
          )}
        </article>

        {me.role === "admin" && (
          <article className="panel settings-panel">
            <div className="section-heading">
              <div>
                <h2>Посади</h2>
                <span>
                  Зразок для всіх філій: звідси посади переносяться в філію
                  кнопкою в її картці
                </span>
              </div>
            </div>
            {titleList("title-library", data.jobTitles, null, () => true)}
            <small className="title-note">
              Ставка й ліміти підставляються, коли працівнику обирають цю
              посаду. При додаванні їх можна змінити — це заготовка, а не
              жорстка прив&apos;язка.
            </small>
          </article>
        )}

        {me.role === "admin" && (
          <article className="panel settings-panel">
            <div className="section-heading">
              <div>
                <h2>Запрошення керуючим</h2>
                <span>
                  Реєстрації в застосунку немає — обліковий запис створюється
                  лише за одноразовим посиланням
                </span>
              </div>
            </div>

            {inviteLink && (
              <div className="invite-link">
                <div>
                  <b>Посилання створено</b>
                  <small>
                    Показуємо один раз: у базі лише його хеш, відновити потім
                    нізвідки. Передайте його запрошеному.
                  </small>
                  <code>{inviteLink}</code>
                </div>
                <button
                  className="account-save ghost"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(inviteLink);
                      setCopied(true);
                    } catch {
                      // Буфер обміну може бути недоступний — посилання видно
                      // й так, лишається виділити його вручну.
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? "✓ Скопійовано" : "Скопіювати"}
                </button>
              </div>
            )}

            <div className="settings-grid invite-form">
              <label className="wide-field">
                Пошта запрошеного
                <input
                  type="email"
                  value={invite.email}
                  onChange={(event) =>
                    setInvite({ ...invite, email: event.target.value })
                  }
                  placeholder="person@example.com"
                />
              </label>
              <label>
                Філія
                <select
                  value={invite.branchId}
                  onChange={(event) =>
                    setInvite({ ...invite, branchId: event.target.value })
                  }
                >
                  <option value="">Оберіть філію</option>
                  {data.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
                <small>Запрошений стане керуючим цієї філії</small>
              </label>
              <label>
                Термін дії, днів
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={invite.days}
                  onChange={(event) =>
                    setInvite({ ...invite, days: event.target.value })
                  }
                />
              </label>
            </div>

            <div className="settings-actions">
              <button
                className="account-save"
                disabled={
                  saving === "invite" ||
                  !invite.email.trim() ||
                  !invite.branchId
                }
                onClick={createInvite}
              >
                {saving === "invite" ? "Створюємо…" : "Створити запрошення"}
              </button>
            </div>

            <div className="invite-list">
              {data.invites.map((row) => (
                <div className="invite-row" key={row.id}>
                  <div className="invite-who">
                    <b>{row.email}</b>
                    <small>
                      {USER_ROLE_LABELS[row.role]}
                      {row.branchName ? ` · філія «${row.branchName}»` : ""}
                      {` · до ${dayLabel(row.expiresAt.slice(0, 10))}`}
                    </small>
                  </div>
                  <em className="invite-status" data-status={row.status}>
                    {INVITE_STATUS_LABELS[row.status]}
                  </em>
                  {row.status !== "accepted" && (
                    <button
                      className="remove-relative"
                      disabled={saving === `revoke-${row.id}`}
                      aria-label={`Скасувати запрошення для ${row.email}`}
                      onClick={() =>
                        send(`revoke-${row.id}`, {
                          kind: "invite_revoke",
                          inviteId: row.id,
                        })
                      }
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {!data.invites.length && (
                <div className="empty">Запрошень керуючим ще не було.</div>
              )}
            </div>
          </article>
        )}

        {me.role === "admin" && (
          <article className="panel settings-panel">
            <div className="section-heading">
              <div>
                <h2>Інші облікові записи</h2>
                <span>
                  Керуючі бачать лише власний профіль — цей список доступний
                  тільки вам
                </span>
              </div>
            </div>

            <div className="account-list">
              {data.others.map((account) => (
                <div className="account-row" key={account.id}>
                  <Avatar
                    userId={account.id}
                    name={draftName(account) || account.email}
                    hasAvatar={account.hasAvatar}
                  />
                  <div className="account-who">
                    <b>{account.email}</b>
                    <small>
                      {USER_ROLE_LABELS[account.role]}
                      {account.branchName
                        ? ` · філія «${account.branchName}»`
                        : ""}
                    </small>
                  </div>
                  <label>
                    ПІБ
                    <input
                      value={draftName(account)}
                      onChange={(event) => {
                        setNames({ ...names, [account.id]: event.target.value });
                        if (saved === `name-${account.id}`) setSaved(null);
                      }}
                      placeholder="Прізвище, ім’я та по батькові"
                    />
                  </label>
                  <button
                    className="account-save ghost"
                    disabled={
                      saving === `name-${account.id}` || nameUnchanged(account)
                    }
                    onClick={() => saveName(account)}
                  >
                    {saving === `name-${account.id}`
                      ? "…"
                      : saved === `name-${account.id}`
                        ? "✓"
                        : "Зберегти"}
                  </button>
                </div>
              ))}
            </div>

            {!data.others.length && (
              <div className="empty">Інших облікових записів ще немає.</div>
            )}
          </article>
        )}
      </section>
    </main>
  );
}
