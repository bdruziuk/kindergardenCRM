"use client";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { USER_ROLE_LABELS } from "@/lib/format";

/** `short` is what the phone tab bar shows — a tab is about 40px wide there,
 *  so the full label cannot fit. It is presentation only: `label` stays the
 *  accessible name at every width. */
const NAV = [
  { icon: "⌂", label: "Огляд", short: "Огляд", href: "/" },
  { icon: "♧", label: "Діти та групи", short: "Діти", href: "/children" },
  { icon: "◷", label: "Черга", short: "Черга", href: "/waitlist" },
  { icon: "₴", label: "Оплати", short: "Оплати", href: "/payments" },
  { icon: "♙", label: "Колектив", short: "Колектив", href: "/staff" },
  { icon: "↗", label: "Доходи й витрати", short: "Доходи", href: "/finances" },
  { icon: "▤", label: "Звіти", short: "Звіти", href: "/reports" },
  { icon: "⚙", label: "Налаштування", short: "Налашт.", href: "/settings" },
];

/** Only the owner manages branches, so this sits outside the shared list. */
const OWNER_NAV = { icon: "⌗", label: "Філії", short: "Філії", href: "/branches" };

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
            aria-current={item.href === active ? "page" : undefined}
            aria-label={item.label}
            className={item.href === active ? "active" : ""}
            href={item.href}
            key={item.label}
            title={item.label}
          >
            <span aria-hidden="true">{item.icon}</span>
            <b className="nav-label">{item.label}</b>
            <b className="nav-label-short">{item.short}</b>
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
