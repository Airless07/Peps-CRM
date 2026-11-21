"use client";

// Sign in / create account / forgot password. Used inside checkout (the cart is kept) and on /account.
import { useState } from "react";

export interface AccountInfo {
  id: string;
  name: string;
  email: string;
  phone: string;
  addresses: { name: string; street1: string; street2: string; city: string; state: string; zip: string; country: string }[];
  /** Signed in with a temporary password: must choose a new one first. */
  mustChangePassword?: boolean;
}

export async function accountApi<T = { account?: AccountInfo; ok?: boolean; message?: string; claim?: boolean }>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/store/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(cleanError(json.error) || "Something went wrong. Try again.");
  return json as T;
}

/** Server validation errors come as "field: message; field: message". Show only the messages. */
export function cleanError(e: unknown): string {
  if (typeof e !== "string") return "";
  return e
    .split("; ")
    .map((part) => part.replace(/^[\w.[\]]+:\s*/, ""))
    .join(" ");
}

type Mode = "signup" | "signin" | "forgot" | "change";

export function AuthPanel({ onDone, initial = "signup", intro }: { onDone: (a: AccountInfo) => void; initial?: Mode; intro?: string }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<AccountInfo | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (mode === "change") {
      if (f.password.length < 8) return setError("Use at least 8 characters for your new password.");
      setBusy(true);
      try {
        const r = await accountApi({ action: "change-password", password: f.password });
        if (r.account) onDone(r.account);
        else if (pending) onDone({ ...pending, mustChangePassword: false });
      } catch (err) {
        setError((err as Error).message);
      }
      setBusy(false);
      return;
    }
    if (mode === "signup" && f.name.trim().length < 2) return setError("Enter your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) return setError("Enter a valid email address, like name@example.com.");
    if (mode === "signup" && f.password.length < 8) return setError("Use at least 8 characters for your password.");
    if (mode === "signin" && !f.password) return setError("Enter your password.");
    setBusy(true);
    try {
      if (mode === "forgot") {
        const r = await accountApi({ action: "reset-request", email: f.email });
        setNotice(r.message ?? "If an account uses that email, a reset link is on its way.");
      } else {
        const r = await accountApi(mode === "signup" ? { action: "signup", ...f } : { action: "signin", email: f.email, password: f.password });
        if (r.claim) {
          // That email already has an account: nothing was created and nobody is signed in.
          setNotice(r.message ?? "This email already has an account with us. We sent a link to claim it.");
          setF({ ...f, password: "" });
        } else if (r.account?.mustChangePassword) {
          setPending(r.account);
          setMode("change");
          setF({ ...f, password: "" });
          setNotice("You signed in with a temporary password. Choose your own password to continue.");
        } else if (r.account) onDone(r.account);
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  const tab = (m: Mode, label: string) => (
    <button type="button" role="tab" aria-selected={mode === m} onClick={() => (setMode(m), setError(""), setNotice(""))} className={`h-11 flex-1 rounded-full text-[15px] font-medium transition ${mode === m ? "bg-paper text-coal shadow-sm" : "text-stone hover:text-coal"}`}>
      {label}
    </button>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {intro && <p className="text-[15px] leading-relaxed text-stone">{intro}</p>}
      {mode !== "forgot" && mode !== "change" && (
        <div role="tablist" aria-label="Account" className="flex rounded-full bg-soft p-1">
          {tab("signup", "Create account")}
          {tab("signin", "Sign in")}
        </div>
      )}
      {mode === "forgot" && <p className="text-[15px] leading-relaxed text-stone">Enter your email and we will send a link to choose a new password.</p>}
      {mode === "signup" && (
        <div>
          <label className="s-label" htmlFor="au-name">
            Full name
          </label>
          <input id="au-name" className="s-input" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
      )}
      {mode !== "change" && <div>
        <label className="s-label" htmlFor="au-email">
          Email
        </label>
        <input id="au-email" type="email" inputMode="email" className="s-input" autoComplete="email" autoCapitalize="none" spellCheck={false} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        {mode === "signup" && <span className="s-hint">Order updates and tracking are sent here.</span>}
      </div>}
      {mode !== "forgot" && (
        <div>
          <label className="s-label" htmlFor="au-pass">
            {mode === "change" ? "New password" : "Password"}
          </label>
          <input id="au-pass" type="password" className="s-input" autoComplete={mode === "signup" || mode === "change" ? "new-password" : "current-password"} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          {(mode === "signup" || mode === "change") && <span className="s-hint">At least 8 characters.</span>}
        </div>
      )}
      {error && (
        <p className="s-error !mt-3" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl bg-soft px-4 py-3 text-[15px]" role="status">
          {notice}
        </p>
      )}
      <button type="submit" disabled={busy} className="s-btn-dark w-full">
        {busy ? "One moment…" : mode === "signup" ? "Create account and continue" : mode === "signin" ? "Sign in" : mode === "change" ? "Save my new password" : "Email me a reset link"}
      </button>
      <div className="text-center text-[15px]">
        {mode === "signin" && (
          <button type="button" className="s-link" onClick={() => (setMode("forgot"), setError(""))}>
            Forgot your password?
          </button>
        )}
        {mode === "forgot" && (
          <button type="button" className="s-link" onClick={() => (setMode("signin"), setNotice(""), setError(""))}>
            Back to sign in
          </button>
        )}
      </div>
    </form>
  );
}
