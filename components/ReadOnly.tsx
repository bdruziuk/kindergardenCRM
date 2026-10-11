"use client";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import type { ScopeDto } from "@/lib/api-schemas";

/**
 * Режим перегляду, як його бачить сервер.
 *
 * Прапорець читаємо з `/api/scope`, а не з токена: супер-адміністратор міг
 * увімкнути його вже після входу, а сервер перевіряє саме базу. Запит один на
 * акаунт, хоч скільки компонентів питає.
 */
let cache: { userId: string; value: Promise<boolean> } | null = null;

function fetchReadOnly(userId: string) {
  if (cache?.userId !== userId)
    cache = {
      userId,
      value: fetch("/api/scope")
        .then((response) => response.json())
        .then((scope: ScopeDto) => Boolean(scope.readOnly))
        .catch(() => false),
    };
  return cache.value;
}

export function useReadOnly() {
  const { data: session } = useSession();
  const user = session?.user;
  const userId = user && user.role !== "superadmin" ? user.id : null;
  const [state, setState] = useState<{ userId: string; value: boolean } | null>(
    null,
  );

  useEffect(() => {
    if (!userId) return;
    let live = true;
    fetchReadOnly(userId).then((value) => {
      if (live) setState({ userId, value });
    });
    return () => {
      live = false;
    };
  }, [userId]);

  return Boolean(userId && state?.userId === userId && state.value);
}

/**
 * Що лишається ввімкненим у режимі перегляду: усе, що лише показує, а не
 * змінює. Решта елементів форм — кнопки, поля, чекбокси, списки, зокрема всі
 * кнопки видалення — вимикається.
 *
 * Список, а не позначка на кожній кнопці: кнопок змін у застосунку сотні, і
 * нова, додана без позначки, мусить бути вимкнена сама — помилитися тут
 * безпечно лише в цей бік. Сервер однаково відхиляє будь-яку зміну; це лише
 * для того, щоб не натискати те, що не спрацює.
 */
const VIEW_CONTROLS = [
  "aside *", // меню, «Ще», вихід
  ".nav-sheet *",
  ".actor-bar *", // «Повернутися в кабінет»
  ".payments-month *", // вибір місяця й «Поточний місяць»
  ".actions label select", // філія, рік, місяць у шапці
  ".search input",
  ".directory-tools select", // «Кого показувати», групи
  ".payment-filters select",
  ".view-switch button", // «Список» / «Табель», періоди, статуси черги
  ".sort-toggle",
  ".group-card", // фільтр за групою
  ".close", // закрити вікно
  ".more", // відкрити картку дитини
  ".paid-link", // історія оплат дитини
  ".earlier-debt-row", // відкрити борг працівника
  ".directory-foot button",
  ".limit-warning button",
  ".lesson-day-head button", // «Згорнути»
  "[data-personal]", // власний акаунт у налаштуваннях
  "[data-personal] *",
].join(",");

const CONTROLS = "button, input, select, textarea";
const MARK = "data-read-only-off";

function lock(root: ParentNode) {
  root.querySelectorAll<HTMLElement>(CONTROLS).forEach((node) => {
    // Лише сторінки застосунку (з бічним меню; діалоги рендеряться всередині
    // них). Вхід, реєстрація й відновлення пароля — поза режимом перегляду.
    if (!node.closest(".shell")) return;
    if (node.matches(VIEW_CONTROLS) || node.hasAttribute(MARK)) return;
    const control = node as HTMLButtonElement;
    if (control.disabled) return;
    control.disabled = true;
    control.setAttribute(MARK, "");
  });
}

function unlock() {
  document.querySelectorAll<HTMLElement>(`[${MARK}]`).forEach((node) => {
    (node as HTMLButtonElement).disabled = false;
    node.removeAttribute(MARK);
  });
}

/**
 * Вимикає елементи форм на всій сторінці, поки акаунт у режимі перегляду.
 *
 * Сторінки й діалоги змінюються й після першого показу, тож нові елементи
 * підхоплює MutationObserver. Якщо React сам знімає `disabled` (скажімо,
 * кнопка після збереження), спостерігач вимикає її знову.
 */
export function ReadOnlyGuard() {
  const readOnly = useReadOnly();

  useEffect(() => {
    if (!readOnly) return;
    document.documentElement.setAttribute("data-read-only", "");
    lock(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          const node = record.target as HTMLElement;
          if (
            node.hasAttribute(MARK) &&
            !(node as HTMLButtonElement).disabled
          )
            (node as HTMLButtonElement).disabled = true;
          else if (node.matches(CONTROLS)) lock(node.parentNode ?? document);
        } else
          record.addedNodes.forEach((added) => {
            if (added instanceof HTMLElement) {
              if (added.matches(CONTROLS)) lock(added.parentNode ?? document);
              else lock(added);
            }
          });
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
    return () => {
      observer.disconnect();
      unlock();
      document.documentElement.removeAttribute("data-read-only");
    };
  }, [readOnly]);

  return null;
}
