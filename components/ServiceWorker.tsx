"use client";
import { useEffect } from "react";

/** Реєструє /sw.js — лише в продакшн-збірці: у dev файли збірки не мають
 *  хешів, і кеш статики підсовував би застарілий код після кожної правки. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Без service worker застосунок працює як звичайний сайт — це не помилка для користувача.
    });
  }, []);
  return null;
}
