"use client";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { USER_ROLE_LABELS } from "@/lib/format";
import { useReadOnly } from "./ReadOnly";

/**
 * Смуга вгорі для двох станів, про які не можна забути:
 *
 * — супер-адміністратор працює від імені власника чи керуючого: без смуги
 *   легко внести зміну як «свою»;
 * — акаунт у режимі перегляду: кнопки на сторінках лишаються, і без смуги
 *   незрозуміло, чому зміни не зберігаються.
 *
 * Повернення в кабінет — повне перезавантаження, а не перехід: сторінки
 * тримають дані чужого садочка в стані, і вони не мають пережити вихід.
 */
export function ActorBar() {
  const { data: session, update } = useSession();
  const [busy, setBusy] = useState(false);
  const user = session?.user;
  const shownReadOnly = useReadOnly();
  if (!user || (!user.actor && !shownReadOnly)) return null;

  return (
    <div className="actor-bar" role="status">
      <span>
        {user.actor ? (
          <>
            Ви працюєте як <b>{user.name || user.email}</b> ·{" "}
            {USER_ROLE_LABELS[user.role]}
            {shownReadOnly ? (
              <>
                {" · "}
                <b>лише перегляд</b>
              </>
            ) : (
              <small className="actor-bar-note">
                {" "}
                — усе, що змінюєте, змінюється в його акаунті
              </small>
            )}
          </>
        ) : (
          <>
            <b>Режим перегляду</b>
            <small className="actor-bar-note">
              {" "}
              — ви можете лише дивитися: додавати, змінювати й видаляти не можна
            </small>
          </>
        )}
      </span>
      {user.actor && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await update({ stopImpersonating: true });
            window.location.assign("/admin");
          }}
        >
          {busy ? "Повертаємось…" : "Повернутися в кабінет"}
        </button>
      )}
    </div>
  );
}
