"use client";
import Link from "next/link";
import { useState } from "react";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch("/api/forgot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const result = (await response.json()) as { ok?: boolean; error?: string };
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSent(true);
  };

  if (sent)
    return (
      <main className="login-shell">
        <div className="login-card">
          <div className="login-brand">
            <b>М</b>
            <span>Малеча</span>
          </div>
          <h1>Перевірте пошту</h1>
          {/* Навмисно не кажемо, чи існує такий запис: інакше форма стала б
              способом дізнатися, хто працює в садочку. */}
          <p className="login-sub">
            Якщо <b>{email}</b> є в системі, ми надіслали туди посилання на
            встановлення пароля. Воно діє дві години й спрацьовує один раз.
          </p>
          <Link className="login-link" href="/login">
            До входу
          </Link>
        </div>
      </main>
    );

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <b>М</b>
          <span>Малеча</span>
        </div>
        <h1>Забули пароль?</h1>
        <p className="login-sub">
          Вкажіть пошту, якою входите — надішлемо посилання на новий пароль
        </p>

        <label>
          Пошта
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        {error && <p className="login-error">{error}</p>}

        <button
          className="primary"
          type="submit"
          disabled={pending || !email.trim()}
        >
          {pending ? "Надсилаємо…" : "Надіслати посилання"}
        </button>
        <Link className="login-link" href="/login">
          Згадав пароль
        </Link>
      </form>
    </main>
  );
}
