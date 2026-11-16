"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = "/admin";
        return;
      }
      const j = await res.json().catch(() => ({}));
      setError(j.error || "Login failed");
    } catch {
      setError("Can't reach the server");
    }
    setBusy(false);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm animate-pop-in">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/icon.svg" alt="" className="mb-4 h-16 w-16 rounded-2xl shadow-sm" />
          <h1 className="text-2xl font-semibold tracking-tight">Buckshot Peps admin</h1>
          <p className="mt-1 text-sm text-muted">Enter the shared password</p>
        </div>
        <div className="relative">
          <Lock size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="h-14 w-full rounded-2xl border border-line bg-surface pl-11 pr-4 text-base transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
        {error && <p className="mt-3 text-center text-sm text-neg">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 h-14 w-full rounded-2xl bg-accent font-medium text-accent-ink transition hover:brightness-110 active:scale-[.98] disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="mt-6 text-center text-xs text-muted">You will stay signed in for 30 days on this device.</p>
      </form>
    </main>
  );
}
