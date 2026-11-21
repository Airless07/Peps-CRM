"use client";

// Small store forms: order lookup, contact, review, password reset, and the account page.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PublicOrder } from "@/lib/store/order-view";
import { accountApi, AuthPanel, cleanError, type AccountInfo } from "./auth-panel";
import { money } from "./cart";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(cleanError(json.error) || "Something went wrong. Check your connection and try again.");
  return json as T;
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-brand-tint px-4 py-3 text-[15px] font-medium text-brand-deep" role="alert">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------- Order lookup
export function LookupForm() {
  const router = useRouter();
  const [number, setNumber] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        if (!/^\d{4,8}$/.test(number.trim().replace(/^#/, ""))) return setError("Enter your order number. It is 4 or more digits, like 1001.");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setError("Enter the email address you used for the order.");
        setBusy(true);
        try {
          const r = await post<{ token: string }>("/api/store/lookup", { number: Number(number.trim().replace(/^#/, "")), email });
          router.push(`/order/${r.token}`);
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <div>
        <label className="s-label" htmlFor="lk-n">
          Order number
        </label>
        <input id="lk-n" className="s-input" inputMode="numeric" placeholder="1001" value={number} onChange={(e) => setNumber(e.target.value)} />
        <span className="s-hint">It is in your confirmation email.</span>
      </div>
      <div>
        <label className="s-label" htmlFor="lk-e">
          Email
        </label>
        <input id="lk-e" type="email" className="s-input" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {error && <Alert>{error}</Alert>}
      <button className="s-btn-primary w-full" disabled={busy}>
        {busy ? "Looking…" : "Find my order"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- Contact
export function ContactForm({ account }: { account: { name: string; email: string } | null }) {
  const [f, setF] = useState({ name: account?.name ?? "", email: account?.email ?? "", orderNumber: "", message: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <div className="rounded-2xl bg-soft p-7" role="status">
        <h2 className="text-2xl font-semibold">Message sent</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-stone">Thanks, {f.name.split(" ")[0]}. We will reply to {f.email}.</p>
        <Link href="/shop" className="s-btn-line mt-5">
          Back to the shop
        </Link>
      </div>
    );
  }
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        if (f.name.trim().length < 2) return setError("Enter your name.");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) return setError("Enter a valid email address so we can reply.");
        if (f.message.trim().length < 10) return setError("Write a few more words so we can help.");
        setBusy(true);
        try {
          await post("/api/store/contact", f);
          setSent(true);
        } catch (err) {
          setError((err as Error).message);
        }
        setBusy(false);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="s-label" htmlFor="ct-n">
            Name
          </label>
          <input id="ct-n" className="s-input" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div>
          <label className="s-label" htmlFor="ct-e">
            Email
          </label>
          <input id="ct-e" type="email" className="s-input" autoComplete="email" autoCapitalize="none" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="s-label" htmlFor="ct-o">
          Order number (optional)
        </label>
        <input id="ct-o" className="s-input" inputMode="numeric" value={f.orderNumber} onChange={(e) => setF({ ...f, orderNumber: e.target.value })} />
      </div>
      {/* Honeypot: hidden from people, tempting for bots. */}
      <div className="hidden" aria-hidden>
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
        </label>
      </div>
      <div>
        <label className="s-label" htmlFor="ct-m">
          Message
        </label>
        <textarea id="ct-m" className="s-input h-auto min-h-[150px] py-3" maxLength={4000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
        <span className="s-hint">We can help with orders, shipping and certificates. We can’t give advice about use.</span>
      </div>
      {error && <Alert>{error}</Alert>}
      <button className="s-btn-primary" disabled={busy}>
        {busy ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- Review
export function ReviewForm({ token, defaultName, orderNumber }: { token: string; defaultName: string; orderNumber: number }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [text, setText] = useState("");
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <div className="rounded-2xl bg-soft p-7" role="status">
        <h2 className="text-2xl font-semibold">Thank you</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-stone">Your review of order #{orderNumber} was received. It appears on the site once our team has looked at it.</p>
        <Link href="/shop" className="s-btn-line mt-5">
          Back to the shop
        </Link>
      </div>
    );
  }
  const words = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        if (rating < 1) return setError("Pick a star rating from 1 to 5.");
        if (!name.trim()) return setError("Enter a display name.");
        setBusy(true);
        try {
          await post(`/api/store/review/${token}`, { rating, text, displayName: name });
          setSent(true);
        } catch (err) {
          setError((err as Error).message);
        }
        setBusy(false);
      }}
    >
      <fieldset>
        <legend className="s-label">Shipping speed, packaging and service</legend>
        <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer p-1" onMouseEnter={() => setHover(n)}>
              <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="peer sr-only" />
              <svg viewBox="0 0 20 20" className={`h-10 w-10 transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand ${n <= (hover || rating) ? "fill-brand" : "fill-rule"}`} aria-hidden>
                <path d="M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z" />
              </svg>
              <span className="sr-only">
                {n} {n === 1 ? "star" : "stars"}
              </span>
            </label>
          ))}
          <span className="ml-3 text-[15px] font-medium" aria-live="polite">
            {words[hover || rating]}
          </span>
        </div>
      </fieldset>
      <div>
        <label className="s-label" htmlFor="rv-t">
          Your review (optional)
        </label>
        <textarea id="rv-t" className="s-input h-auto min-h-[130px] py-3" maxLength={1500} value={text} onChange={(e) => setText(e.target.value)} />
        <span className="s-hint">Please review your order experience. Reviews about product use or results will not be published.</span>
      </div>
      <div>
        <label className="s-label" htmlFor="rv-n">
          Display name
        </label>
        <input id="rv-n" className="s-input max-w-xs" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <span className="s-hint">Shown next to your review with a “Verified buyer” label.</span>
      </div>
      {error && <Alert>{error}</Alert>}
      <button className="s-btn-primary" disabled={busy}>
        {busy ? "Sending…" : "Submit review"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- Password reset
export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        if (pw.length < 8) return setError("Use at least 8 characters for your password.");
        setBusy(true);
        try {
          await accountApi({ action: "reset", token, password: pw });
          router.push("/account");
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <div>
        <label className="s-label" htmlFor="rs-p">
          New password
        </label>
        <input id="rs-p" type="password" className="s-input" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <span className="s-hint">At least 8 characters.</span>
      </div>
      {error && <Alert>{error}</Alert>}
      <button className="s-btn-primary w-full" disabled={busy}>
        {busy ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- Invite / claim
export function InviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        if (pw.length < 8) return setError("Use at least 8 characters for your password.");
        setBusy(true);
        try {
          await accountApi({ action: "claim", token, password: pw });
          router.push("/account");
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <div>
        <label className="s-label" htmlFor="iv-p">
          Choose a password
        </label>
        <input id="iv-p" type="password" className="s-input" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <span className="s-hint">At least 8 characters.</span>
      </div>
      {error && <Alert>{error}</Alert>}
      <button className="s-btn-primary w-full" disabled={busy}>
        {busy ? "Saving…" : "Save password and sign in"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- Account
export interface AccountCredit {
  balanceCents: number;
  referralCode: string;
  history: { id: string; date: string; amountCents: number; reason: string; orderNumber: number | null }[];
}

export function AccountView({ account, orders, statusText, credit }: { account: AccountInfo | null; orders: PublicOrder[]; statusText: Record<string, string>; credit?: AccountCredit | null }) {
  const router = useRouter();
  const [addresses, setAddresses] = useState(account?.addresses ?? []);
  const [copied, setCopied] = useState(false);
  if (account?.mustChangePassword) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="text-4xl font-semibold" style={{ letterSpacing: "-0.03em" }}>
          Choose a new password
        </h1>
        <p className="mb-7 mt-3 text-[1.0625rem] leading-relaxed text-stone">You signed in with a temporary password. Choose your own to continue.</p>
        <AuthPanel initial="change" onDone={() => router.refresh()} />
      </div>
    );
  }
  if (!account) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="text-4xl font-semibold" style={{ letterSpacing: "-0.03em" }}>
          Your account
        </h1>
        <p className="mb-7 mt-3 text-[1.0625rem] leading-relaxed text-stone">Sign in to see your orders and tracking, or create an account.</p>
        <AuthPanel initial="signin" onDone={() => router.refresh()} />
      </div>
    );
  }
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold sm:text-5xl" style={{ letterSpacing: "-0.03em" }}>
            Hello, {account.name.split(" ")[0]}
          </h1>
          <p className="mt-2 text-stone">{account.email}</p>
        </div>
        <button
          type="button"
          className="s-btn-line h-10 px-4 text-sm"
          onClick={async () => {
            await accountApi({ action: "signout" });
            router.refresh();
          }}
        >
          Sign out
        </button>
      </div>

      {credit && (
        <div className="mt-10 grid gap-4 sm:grid-cols-2" data-account-credit>
          <div className="rounded-2xl bg-soft p-5">
            <div className="text-sm font-medium text-stone">Store credit</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums" data-account-balance>
              {money(credit.balanceCents)}
            </div>
            <p className="mt-1 text-sm text-stone">Use it at checkout, all or part of it.</p>
          </div>
          {credit.referralCode && (
            <div className="rounded-2xl border border-rule p-5">
              <div className="text-sm font-medium text-stone">Your referral code</div>
              <div className="mt-1 flex items-center gap-3">
                <span className="font-mono text-2xl font-semibold tracking-wider" data-account-referral>
                  {credit.referralCode}
                </span>
                <button
                  type="button"
                  className="s-link text-sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(credit.referralCode);
                      setCopied(true);
                    } catch {}
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-1 text-sm text-stone">Friends enter it at checkout. You earn store credit when their order is paid.</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-12 grid gap-x-16 gap-y-12 lg:grid-cols-[1.6fr_1fr]">
        <section>
          <h2 className="text-xl font-semibold">Orders</h2>
          {orders.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-rule px-6 py-12 text-center">
              <p className="font-semibold">No orders yet</p>
              <p className="mt-1 text-[15px] text-stone">Your orders, their status and tracking will show up here.</p>
              <Link href="/shop" className="s-btn-primary mt-5">
                Shop all products
              </Link>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-rule border-y border-rule">
              {orders.map((o) => (
                <li key={o.token}>
                  <Link href={`/order/${o.token}`} className="group flex flex-wrap items-center gap-x-6 gap-y-1 py-4">
                    <span className="w-20 text-[1.0625rem] font-semibold tabular-nums group-hover:text-brand">#{o.number}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{o.lines.map((l) => `${l.quantity > 1 ? `${l.quantity}× ` : ""}${l.name}`).join(", ")}</span>
                      <span className="block text-sm text-stone">
                        {date(o.placedAt)} · <span className={o.status === "awaiting_payment" ? "font-medium text-brand" : ""}>{statusText[o.status]}</span>
                        {o.tracking ? ` · ${o.tracking.carrier} ${o.tracking.number}` : ""}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{money(o.totalCents)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          {credit && (
            <div className="mb-12">
              <h2 className="text-xl font-semibold">Store credit history</h2>
              {credit.history.length === 0 ? (
                <p className="mt-4 text-[15px] leading-relaxed text-stone">No store credit yet.</p>
              ) : (
                <ul className="mt-4 divide-y divide-rule border-y border-rule" data-account-credit-history>
                  {credit.history.map((h) => (
                    <li key={h.id} className="flex items-start justify-between gap-4 py-3 text-[15px]">
                      <span className="min-w-0">
                        <span className="block">{h.reason || "Store credit"}</span>
                        <span className="block text-sm text-stone">{date(h.date)}</span>
                      </span>
                      <span className={`shrink-0 font-semibold tabular-nums ${h.amountCents < 0 ? "" : "text-brand"}`}>
                        {h.amountCents < 0 ? `-${money(-h.amountCents)}` : `+${money(h.amountCents)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <h2 className="text-xl font-semibold">Saved addresses</h2>
          {addresses.length === 0 ? (
            <p className="mt-4 text-[15px] leading-relaxed text-stone">The address you use at checkout is saved here for next time.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {addresses.map((a, i) => (
                <li key={i} className="flex items-start justify-between gap-4 rounded-xl border border-rule p-4">
                  <address className="text-[15px] not-italic leading-relaxed">
                    <span className="font-medium">{a.name}</span>
                    <br />
                    {a.street1}
                    {a.street2 ? `, ${a.street2}` : ""}
                    <br />
                    {a.city}, {a.state} {a.zip}
                  </address>
                  <button
                    type="button"
                    className="shrink-0 text-sm font-medium text-stone underline decoration-rule underline-offset-4 hover:text-coal"
                    onClick={async () => {
                      const next = addresses.filter((_, k) => k !== i);
                      setAddresses(next);
                      await accountApi({ action: "addresses", addresses: next }).catch(() => setAddresses(addresses));
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
