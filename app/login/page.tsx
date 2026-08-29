"use client";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const callbackUrl = useSearchParams().get("callbackUrl") ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setPending(false);
    if (result?.error) {
      setError("Невірна пошта або пароль");
      return;
    }
    // No router.refresh() here: it re-fetches the *current* route, which is
    // still /login, and the proxy bounces an authenticated /login to "/" —
    // knocking the user off the page they just signed in to.
    router.push(callbackUrl);
  };

  return (
    <form className="login-card" onSubmit={submit}>
      <div className="login-brand">
        <b>М</b>
        <span>Малеча</span>
      </div>
      <h1>Вхід до системи</h1>
      <p className="login-sub">Облік садочка доступний лише колективу</p>

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
      <label>
        Пароль
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      {error && <p className="login-error">{error}</p>}

      <button className="primary" type="submit" disabled={pending}>
        {pending ? "Входимо…" : "Увійти"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="login-shell">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
