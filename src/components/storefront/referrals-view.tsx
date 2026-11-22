"use client";

// The customer's Referrals dashboard (inside the account area): their code, sharing, numbers, uses and history.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { CODE_MAX, CODE_PROBLEM_TEXT, codeProblem } from "@/lib/referral-rules";
import type { ReferralDashboard } from "@/lib/store/referral-dashboard";
import { accountApi } from "./auth-panel";
import { money } from "./cart";

const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const signed = (c: number) => (c < 0 ? `-${money(-c)}` : `+${money(c)}`);

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Overview / Referrals tabs at the top of the account area. */
export function AccountTabs() {
  const path = usePathname();
  const tabs = [
    { href: "/account", label: "Overview" },
    { href: "/account/referrals", label: "Referrals" },
  ];
  return (
    <nav aria-label="Your account" className="mb-8 flex gap-1 border-b border-rule" data-account-tabs>
      {tabs.map((t) => {
        const on = path === t.href;
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} className={`-mb-px border-b-2 px-4 py-3 text-[15px] font-medium transition ${on ? "border-brand text-coal" : "border-transparent text-stone hover:text-coal"}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

function useToastLine() {
  const [msg, setMsg] = useState("");
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (m: string) => {
    setMsg(m);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(""), 3200);
  };
  const node = msg ? (
    <div role="status" className="fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 rounded-full bg-coal px-5 py-3 text-sm font-medium text-white shadow-lg animate-rise-in" data-toast>
      <Check size={16} /> {msg}
    </div>
  ) : null;
  return { show, node };
}

const STATUS_CLS: Record<string, string> = {
  Pending: "bg-soft text-stone",
  Available: "bg-brand-tint text-brand-deep",
  Reversed: "bg-rule text-stone line-through decoration-1",
};

export function ReferralsView({ data, shareBase, rewardPercent, buyerPercent }: { data: ReferralDashboard; shareBase: string; rewardPercent: number; buyerPercent: number }) {
  const router = useRouter();
  const toast = useToastLine();
  const [code, setCode] = useState(data.code);
  const [draft, setDraft] = useState(data.code);
  const [msg, setMsg] = useState("");
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const share = `${shareBase}/shop?ref=${encodeURIComponent(code)}`;

  // Live messages: format rules right away, "taken" from the server shortly after typing stops.
  useEffect(() => {
    const value = draft.trim();
    if (value === code) return setMsg("");
    const p = codeProblem(value);
    if (p) return setMsg(value ? CODE_PROBLEM_TEXT[p] : CODE_PROBLEM_TEXT.empty);
    setMsg("");
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await accountApi<{ ok: boolean; message: string }>({ action: "check-code", code: value });
        setMsg(r.message || "");
      } catch (e) {
        setMsg((e as Error).message);
      } finally {
        setChecking(false);
      }
    }, 400);
    return () => (clearTimeout(t), setChecking(false));
  }, [draft, code]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (msg || checking || draft.trim() === code) return;
    setSaving(true);
    try {
      const r = await accountApi<{ code: string }>({ action: "referral-code", code: draft.trim() });
      setCode(r.code);
      setDraft(r.code);
      toast.show(`Your code is now ${r.code}`);
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const changed = draft.trim() !== code;
  const valid = changed && !msg && !checking && !!draft.trim();

  return (
    <div data-referrals-dashboard>
      <div className="max-w-2xl">
        <h1 className="text-4xl font-semibold sm:text-5xl" style={{ letterSpacing: "-0.03em" }}>
          Referrals
        </h1>
        <p className="mt-3 text-[1.0625rem] leading-relaxed text-stone">
          Share your code. When a friend orders with it, you earn {rewardPercent}% of their order in store credit once the order is paid.
          {buyerPercent > 0 ? ` Your friends get ${buyerPercent}% off.` : ""}{" "}
          <Link href="/refer" className="s-link">
            How it works
          </Link>
        </p>
      </div>

      {data.negative && (
        <p className="mt-6 rounded-xl bg-brand-tint px-4 py-3 text-[15px] font-medium text-brand-deep" role="alert" data-negative-balance>
          Your store credit is {money(data.balanceCents)} because an order that earned you credit was refunded after the credit was used. New credit pays this off first.
        </p>
      )}

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section className="rounded-2xl border border-rule p-5 sm:p-6">
          <div className="text-sm font-medium text-stone">Your code</div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span className="break-all font-mono text-3xl font-semibold tracking-wider" data-referral-code>
              {code}
            </span>
            <button type="button" className="s-btn-line h-10 px-4 text-sm" onClick={async () => (await copy(code)) && toast.show("Code copied")} data-copy-code>
              <Copy size={15} /> Copy
            </button>
          </div>
          <div className="mt-5">
            <div className="s-label">Share link</div>
            <div className="flex gap-2">
              <input readOnly value={share} className="s-input min-w-0 flex-1 text-sm text-stone" aria-label="Share link" onFocus={(e) => e.currentTarget.select()} data-share-link />
              <button type="button" className="s-btn-line h-12 shrink-0 px-4 text-sm" onClick={async () => (await copy(share)) && toast.show("Link copied")} data-copy-link>
                <Link2 size={15} /> Copy link
              </button>
            </div>
            <span className="s-hint">Opens the shop with your code ready at checkout.</span>
          </div>
          <form onSubmit={save} className="mt-6 border-t border-rule pt-5" data-code-form>
            <label className="s-label" htmlFor="ref-code">
              Change your code
            </label>
            <div className="flex gap-2">
              <input
                id="ref-code"
                className={`s-input min-w-0 flex-1 font-mono tracking-wide ${msg ? "!border-brand" : ""}`}
                value={draft}
                maxLength={CODE_MAX + 5}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                aria-invalid={!!msg}
                aria-describedby="ref-code-msg"
              />
              <button type="submit" className="s-btn-primary h-12 shrink-0 px-5" disabled={!valid || saving} data-update-code>
                {saving ? "Saving…" : "Update"}
              </button>
            </div>
            <p id="ref-code-msg" className={msg ? "s-error" : "s-hint"} aria-live="polite" data-code-message>
              {msg || (changed && checking ? "Checking…" : changed && valid ? "Available." : "3 to 20 letters, numbers or dashes. Not case sensitive. Your old code stops working right away; credit you earned stays.")}
            </p>
          </form>
        </section>

        <section className="grid grid-cols-2 gap-3 self-start" data-referral-stats>
          {[
            ["Total uses", String(data.uses), "uses"],
            ["Credit earned", money(data.earnedCents), "earned"],
            ["Pending", money(data.pendingCents), "pending"],
            ["Available store credit", money(data.balanceCents), "available"],
          ].map(([label, value, key]) => (
            <div key={key} className="rounded-2xl bg-soft p-4 sm:p-5">
              <div className="text-sm font-medium text-stone">{label}</div>
              <div className={`mt-1 text-2xl font-semibold tabular-nums ${key === "available" && data.negative ? "text-brand" : ""}`} data-stat={key}>
                {value}
              </div>
            </div>
          ))}
          <p className="col-span-2 text-sm text-stone">Pending credit becomes spendable once the order is paid. Credit is removed if an order is canceled or refunded.</p>
        </section>
      </div>

      <div className="mt-12 grid gap-x-16 gap-y-12 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <h2 className="text-xl font-semibold">Orders with your code</h2>
          {data.useRows.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-rule px-6 py-10 text-center">
              <p className="font-semibold">No uses yet</p>
              <p className="mt-1 text-[15px] text-stone">Share your code or link. Every order placed with it shows up here.</p>
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-2xl border border-rule" data-referral-uses>
              <div className="hidden grid-cols-[1.3fr_1fr_0.8fr_0.9fr] gap-3 bg-soft px-4 py-2.5 text-[13px] font-medium text-stone sm:grid">
                <span>Friend</span>
                <span>Date</span>
                <span className="text-right">Credit</span>
                <span className="text-right">Status</span>
              </div>
              <ul className="divide-y divide-rule">
                {data.useRows.map((u) => (
                  <li key={u.id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-4 py-3 text-[15px] sm:grid-cols-[1.3fr_1fr_0.8fr_0.9fr] sm:items-center" data-use-row>
                    <span className="font-medium">{u.buyer}</span>
                    <span className="text-right font-semibold tabular-nums sm:order-3">{money(u.creditCents)}</span>
                    <span className="text-sm text-stone sm:order-2 sm:text-[15px]">{date(u.date)}</span>
                    <span className="text-right sm:order-4">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${STATUS_CLS[u.status]}`}>{u.status}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-xl font-semibold">Store credit history</h2>
          {data.history.length === 0 ? (
            <p className="mt-4 text-[15px] leading-relaxed text-stone">No store credit yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-rule border-y border-rule" data-credit-history>
              {data.history.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-4 py-3 text-[15px]">
                  <span className="min-w-0">
                    <span className="block">{h.label}</span>
                    <span className="block text-sm text-stone">
                      {h.type} · {date(h.date)}
                    </span>
                  </span>
                  <span className={`shrink-0 font-semibold tabular-nums ${h.amountCents < 0 ? "" : "text-brand"}`}>{signed(h.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {toast.node}
    </div>
  );
}

/** Order confirmation: "Know someone who'd want this?" with the viewer's code (signed in) or a sign-up link. */
export function ShareCodeBanner({ code, percent }: { code: string | null; percent: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="s-wrap pb-10" data-share-banner>
      <div className="flex flex-col gap-4 rounded-2xl bg-soft p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <p className="text-[1.0625rem] font-semibold">Know someone who&apos;d want this?</p>
          <p className="mt-1 text-[15px] text-stone">
            Share your code and earn store credit{percent > 0 ? ` (${percent}% of their order)` : ""}.{" "}
            <Link href="/refer" className="s-link">
              How it works
            </Link>
          </p>
        </div>
        {code ? (
          <div className="flex items-center gap-3">
            <span className="font-mono text-xl font-semibold tracking-wider" data-share-code>
              {code}
            </span>
            <button type="button" className="s-btn-line h-10 px-4 text-sm" onClick={async () => setCopied(await copy(code))}>
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <Link href="/account/referrals" className="s-btn-primary h-11 shrink-0 px-5 text-sm" data-share-signup>
            Create an account to get your code
          </Link>
        )}
      </div>
    </section>
  );
}
