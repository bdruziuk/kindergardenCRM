"use client";
import { useEffect, useRef } from "react";

/**
 * Overlay + panel used by every dialog in the app. Closes on Escape and on a
 * click that starts on the backdrop itself, which is why the panel needs no
 * stopPropagation of its own.
 *
 * Focus moves into the panel on open, stays inside it while it is open and
 * returns to whatever opened it on close — without that, Tab walks off into
 * the page behind the overlay.
 */
export function Modal({
  className,
  onClose,
  labelledBy,
  children,
}: {
  className: string;
  onClose: () => void;
  labelledBy?: string;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((node) => node.offsetParent !== null);

    // A real field beats the close button as a landing spot; the panel itself
    // is the fallback for a dialog that is pure text.
    const first = focusable().find((node) => !node.classList.contains("close"));
    (first ?? panel.current)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (!nodes.length) return;
      const inside = panel.current?.contains(document.activeElement);
      const edge = event.shiftKey ? nodes[0] : nodes[nodes.length - 1];
      if (!inside || document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? nodes[nodes.length - 1] : nodes[0]).focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={className}
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        <button className="close" onClick={onClose} aria-label="Закрити">
          ×
        </button>
        {children}
      </section>
    </div>
  );
}
