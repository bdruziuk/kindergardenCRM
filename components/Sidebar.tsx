"use client";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { USER_ROLE_LABELS } from "@/lib/format";

const NAV = [
  { icon: "⌂", label: "Огляд", href: "/" },
  { icon: "♧", label: "Діти та групи", href: "/children" },
  { icon: "◷", label: "Черга", href: "/waitlist" },
  { icon: "₴", label: "Оплати", href: "/payments" },
  { icon: "♙", label: "Колектив", href: "/staff" },
  { icon: "↗", label: "Доходи й витрати", href: "/finances" },
  { icon: "▤", label: "Звіти", href: "/reports" },
  { icon: "⚙", label: "Налаштування", href: "/settings" },
];

/** Only the owner manages branches, so this sits outside the shared list. */
const OWNER_NAV = { icon: "⌗", label: "Філії", href: "/branches" };

/** `active` is the href of the current page — by path rather than position, so
 *  inserting a nav item does not renumber every page. */
export function Sidebar({ active }: { active: string }) {
  const { data: session } = useSession();
  const user = session?.user;
  const displayName = user?.name || user?.email || "—";
  // «Філії» — власникова сторінка, тож вона стає перед налаштуваннями, а не
  // в кінці списку.
  const nav =
    user?.role === "admin"
      ? [...NAV.slice(0, -1), OWNER_NAV, NAV[NAV.length - 1]]
      : NAV;

  return (
    <aside>
      <div className="brand">
        <b>М</b>Малеча
      </div>
      <nav>
        {nav.map((item) => (
          <Link
            className={item.href === active ? "active" : ""}
            href={item.href}
            key={item.label}
          >
            <span>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="profile">
        <Avatar
          userId={Number(user?.id ?? 0)}
          name={displayName}
          hasAvatar={Boolean(user?.hasAvatar)}
        />
        <div>
          <b>{displayName}</b>
          <small>{user ? USER_ROLE_LABELS[user.role] : ""}</small>
        </div>
        <button
          className="sign-out"
          onClick={() => signOut({ callbackUrl: "/login" })}
          title="Вийти"
          aria-label="Вийти"
        >
          ⏻
        </button>
      </div>
    </aside>
  );
}
