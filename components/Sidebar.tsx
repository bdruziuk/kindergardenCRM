"use client";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { USER_ROLE_LABELS } from "@/lib/format";

/** `short` is what the phone tab bar shows — a tab is narrow there, so the
 *  full label cannot fit. It is presentation only: `label` stays the
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

/** A phone tab bar fits about five tabs. The first five entries above are the
 *  ones opened daily; everything after them lives behind «Ще». The sidebar
 *  itself is untouched — on a tablet rail and on desktop the whole list still
 *  shows, and the split is made in CSS so no viewport is measured in JS. */
const PHONE_TABS = 5;

/** `active` is the href of the current page — by path rather than position, so
 *  inserting a nav item does not renumber every page. */
export function Sidebar({ active }: { active: string }) {
  const { data: session } = useSession();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const user = session?.user;
  const displayName = user?.name || user?.email || "—";
  // «Філії» — власникова сторінка, тож вона стає перед налаштуваннями, а не
  // в кінці списку.
  const nav =
    user?.role === "admin"
      ? [...NAV.slice(0, -1), OWNER_NAV, NAV[NAV.length - 1]]
      : NAV;
  const overflow = nav.slice(PHONE_TABS);
  // A page reached through «Ще» still has to look reachable from the bar.
  const overflowActive = overflow.some((item) => item.href === active);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const tab = (item: (typeof NAV)[number]) => (
    <Link
      aria-current={item.href === active ? "page" : undefined}
      aria-label={item.label}
      className={item.href === active ? "active" : ""}
      href={item.href}
      key={item.label}
      onClick={() => setMoreOpen(false)}
      title={item.label}
    >
      <span aria-hidden="true">{item.icon}</span>
      <b className="nav-label">{item.label}</b>
      <b className="nav-label-short">{item.short}</b>
    </Link>
  );

  return (
    <aside>
      <div className="brand">
        <b>М</b>Малеча
      </div>
      <nav>
        {nav.map(tab)}
        {/* Hidden above the phone breakpoint, where every tab is on the bar. */}
        <button
          aria-controls="nav-more"
          aria-expanded={moreOpen}
          aria-label="Інші розділи"
          className={`nav-more${overflowActive ? " active" : ""}`}
          onClick={() => setMoreOpen((open) => !open)}
          ref={moreButton}
          type="button"
        >
          <span aria-hidden="true">⋯</span>
          <b className="nav-label-short">Ще</b>
        </button>
      </nav>
      {moreOpen && (
        <div
          className="nav-sheet-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMoreOpen(false);
          }}
          role="presentation"
        >
          <div className="nav-sheet" id="nav-more">
            {overflow.map(tab)}
          </div>
        </div>
      )}
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
