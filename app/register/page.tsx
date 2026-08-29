"use client";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { InviteCheckDto } from "@/lib/api-schemas";
import { USER_ROLE_LABELS } from "@/lib/format";

function RegisterForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [invite, setInvite] = useState<InviteCheckDto | null>(null);
  const [checking, setChecking] = useState(Boolean(token));
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(
    token ? null : "Посилання без токена запрошення",
  );
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch("/api/register?token=" + encodeURIComponent(token))
      .then((response) => response.json())
      .then((next: InviteCheckDto) =>
        next.error ? setError(next.error) : setInvite(next),
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

    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, name, password }),
    });
    const result = (await response.json()) as { email?: string; error?: string };
    if (result.error || !result.email) {
      setPending(false);
      setError(result.error ?? "Не вдалося створити обліковий запис");
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
    if (signedIn?.error) {
      router.push("/login");
      return;
    }
    router.push("/");
  };

  if (checking)
    return (
      <div className="login-card">
        <div className="login-brand">
          <b>М</b>
          <span>Малеча</span>
        </div>
        <p className="login-sub">Перевіряємо запрошення…</p>
      </div>
    );

  if (!invite)
    return (
      <div className="login-card">
        <div className="login-brand">
          <b>М</b>
          <span>Малеча</span>
        </div>
        <h1>Запрошення не діє</h1>
        <p className="login-sub">
          {error ?? "Запрошення недійсне або вже використане"}
        </p>
        <p className="login-sub">
          Попросіть власника надіслати нове посилання.
        </p>
        <a className="login-link" href="/login">
          До входу
        </a>
      </div>
    );

  return (
    <form className="login-card" onSubmit={submit}>
      <div className="login-brand">
        <b>М</b>
        <span>Малеча</span>
      </div>
      <h1>Створення запису</h1>
      <p className="login-sub">
        Запрошення для <b>{invite.email}</b> —{" "}
        {USER_ROLE_LABELS[invite.role].toLowerCase()}
        {invite.branchName ? `, філія «${invite.branchName}»` : ""}
      </p>

      <label>
        ПІБ
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Прізвище, ім’я та по батькові"
          autoComplete="name"
          required
        />
      </label>
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
        disabled={pending || !name.trim() || password.length < 8}
      >
        {pending ? "Створюємо…" : "Створити запис і увійти"}
      </button>
      <p className="login-hint">
        Пошту задає запрошення — змінити її тут не можна.
      </p>
    </form>
  );
}

export default function RegisterPage() {
  return (
    <main className="login-shell">
      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>
    </main>
  );
}
