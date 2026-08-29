"use client";
import { useEffect } from "react";

/**
 * Overlay + panel used by every dialog in the app. Closes on Escape and on a
 * click that starts on the backdrop itself, which is why the panel needs no
 * stopPropagation of its own.
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
