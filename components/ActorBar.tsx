"use client";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { USER_ROLE_LABELS } from "@/lib/format";

/**
 * Смуга вгорі, поки супер-адміністратор працює від імені власника чи
 * керуючого. Без неї легко забути, чий це акаунт, і внести зміну як «свою».
 *
 * Повернення — повне перезавантаження, а не перехід: сторінки тримають дані
 * чужого садочка в стані, і вони не мають пережити вихід.
 */
export function ActorBar() {
  const { data: session, update } = useSession();
  const [busy, setBusy] = useState(false);
  const user = session?.user;
  if (!user?.actor) return null;

  return (
    <div className="actor-bar" role="status">
      <span>
        Ви працюєте як <b>{user.name || user.email}</b> ·{" "}
        {USER_ROLE_LABELS[user.role]}
        <small className="actor-bar-note">
          {" "}
          — усе, що змінюєте, змінюється в його акаунті
        </small>
      </span>
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
    </div>
  );
}
