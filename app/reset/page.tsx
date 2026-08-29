"use client";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(Boolean(token));
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(
    token ? null : "Посилання без токена",
  );
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch("/api/reset?token=" + encodeURIComponent(token))
      .then((response) => response.json())
      .then((next: { email?: string; error?: string }) =>
        next.error ? setError(next.error) : setEmail(next.email ?? null),
      )
      .catch(() => setError("Немає зв’язку із сервером"))
      .finally(() => setChecking(false));
  }, [token]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== repeat) {
      setError("Паролі не збігаються");
      return;
    }
    setPending(true);
    setError(null);

    const response = await fetch("/api/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const result = (await response.json()) as { email?: string; error?: string };
    if (result.error || !result.email) {
      setPending(false);
      setError(result.error ?? "Не вдалося змінити пароль");
      return;
    }

    // Пароль ще в пам'яті форми — заводимо сесію одразу, щоб людина не
    // передруковувала його на сторінці входу.
    const signedIn = await signIn("credentials", {
      email: result.email,
      password,
      redirect: false,
    });
    setPending(false);
    router.push(signedIn?.error ? "/login" : "/");
  };

  const shell = (children: React.ReactNode) => (
    <div className="login-card">
      <div className="login-brand">
        <b>М</b>
        <span>Малеча</span>
      </div>
      {children}
    </div>
  );

  if (checking) return shell(<p className="login-sub">Перевіряємо посилання…</p>);

  if (!email)
    return shell(
      <>
        <h1>Посилання не діє</h1>
        <p className="login-sub">
          {error ?? "Посилання недійсне або вже використане"}
        </p>
        <p className="login-sub">
          Термін дії — дві години, і спрацьовує воно один раз. Запросіть нове.
        </p>
        <Link className="login-link" href="/forgot">
          Надіслати нове
        </Link>
      </>,
    );

  return (
    <form className="login-card" onSubmit={submit}>
      <div className="login-brand">
        <b>М</b>
        <span>Малеча</span>
      </div>
      <h1>Новий пароль</h1>
      <p className="login-sub">
        Для <b>{email}</b>
      </p>

      <label>
        Пароль
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </label>
      <label>
        Повторіть пароль
        <input
          type="password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </label>

      {error && <p className="login-error">{error}</p>}

      <button
        className="primary"
        type="submit"
        disabled={pending || password.length < 8}
      >
        {pending ? "Зберігаємо…" : "Зберегти й увійти"}
      </button>
    </form>
  );
}

export default function ResetPage() {
  return (
    <main className="login-shell">
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </main>
  );
}
