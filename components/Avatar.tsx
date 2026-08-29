"use client";
import { useState } from "react";
import { initialsOf } from "@/lib/format";

/**
 * Аватарка з відкотом на ініціали.
 *
 * `hasAvatar` — лише підказка, щоб не смикати сервер по людях без знімка; якщо
 * картинка все-таки не завантажилась (стерли в іншій вкладці, немає зв'язку),
 * лишаються ініціали, а не порожній квадрат.
 */
export function Avatar({
  userId,
  name,
  hasAvatar,
  className = "",
}: {
  userId: number;
  name: string;
  hasAvatar: boolean;
  className?: string;
}) {
  // Помилку запам'ятовуємо разом із тим, для чого вона сталася: після заміни
  // знімка адреса та сама, і без цього ініціали лишились би назавжди. Ключ
  // замість ефекту — стан виводиться, а не синхронізується.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const key = `${userId}:${hasAvatar}`;

  return (
    <i className={"avatar " + className}>
      {hasAvatar && failedFor !== key ? (
        // Знімок уже обрізаний до 256 px у браузері й віддається власним
        // маршрутом — next/image оптимізував би вже оптимізоване.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/avatar/${userId}`}
          alt=""
          onError={() => setFailedFor(key)}
        />
      ) : (
        initialsOf(name)
      )}
    </i>
  );
}
