"use client";

// Customer page sections: website account (invite, reset, temporary password), store credit, referrals.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Gift, KeyRound, Mail, Send, Share2 } from "lucide-react";
import { balanceOf, CREDIT_REASONS, pendingOf } from "@/lib/credit";
import { CODE_PROBLEM_TEXT, codeProblem } from "@/lib/referral-rules";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { ACCOUNT_STATUS_LABEL, type CustomerRec } from "@/lib/types";
import { ReferrerPicker } from "./credit-controls";
import { api, useLoaded } from "./store";
import { useToast } from "./toast";
import { Badge, Button, Field, Input, MoneyInput, Segmented, Sheet, cx } from "./ui";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

let resendKnown: boolean | null = null;
function useResend() {
  const [on, setOn] = useState<boolean | null>(resendKnown);
  useEffect(() => {
    if (resendKnown !== null) return;
    api<{ resend: boolean }>("/api/settings/test")
      .then((k) => {
        resendKnown = k.resend;
        setOn(k.resend);
      })
      .catch(() => setOn(false));
  }, []);
  return on;
}

const sectionCls = "rounded-2xl border border-line p-4";
const headCls = "flex items-center gap-2 font-medium";

export function AccountSection({ c }: { c: CustomerRec }) {
  const s = useLoaded();
  const toast = useToast();
  const resend = useResend();
  const [busy, setBusy] = useState<string | null>(null);
  const [tempOpen, setTempOpen] = useState(false);
  const [temp, setTemp] = useState("");
  /** The link just made. Only its hash is stored, so it can be shown only now (make a new one to see it again). */
  const [link, setLink] = useState<{ customerId: string; url: string } | null>(null);
  if (!s) return null;
  const status = c.accountStatus ?? (c.hasAccount ? "active" : c.email ? "invited" : "none");
  const inv = c.invite;
  const shownLink = link && link.customerId === c.id && inv?.state === "open" ? link.url : null;

  async function run(action: "invite-link" | "invite-email" | "reset-email" | "temp-password", extra: Record<string, unknown> = {}) {
    setBusy(action);
    let message = "";
    let tone: "success" | "error" | undefined;
    await s!.mutate(null, async () => {
      const r = await api<{ url?: string; message: string; ok?: boolean }>(`/api/customers/${c.id}/account`, "POST", { action, ...extra });
      if (r.url) {
        setLink({ customerId: c.id, url: r.url });
        message = "New invite link made. Copy it below. It works once, and any older link stopped working.";
      } else message = r.message;
      tone = r.ok === false ? "error" : "success";
    });
    setBusy(null);
    if (message) toast.show({ message, tone, duration: 6000 });
  }

  return (
    <div className={sectionCls} data-account-section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={headCls}>
          <KeyRound size={17} /> Website account
        </div>
        <Badge tone={status === "active" ? "pos" : status === "invited" ? "accent" : "neutral"}>
          <span data-account-status>{ACCOUNT_STATUS_LABEL[status]}</span>
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted">
        {status === "none" && "No email yet. Create an invite link and send it to them: they add their own email and password, and keep their store credit and orders."}
        {status === "invited" && `Has an account with ${c.email}, but no password yet. Send them the invite link so they can set one and see their store credit.`}
        {status === "active" && `Signs in with ${c.email}.`}
      </p>
      <div className="mt-1 text-sm text-muted">
        Last login: <span className="font-medium text-ink">{c.lastLoginAt ? fmtDateTime(c.lastLoginAt) : "Never"}</span>
        {c.mustChangePassword && <span className="ml-2 text-warn">Temporary password set (must change it)</span>}
      </div>
      {inv && inv.state !== "none" && (
        <div className="mt-2 text-sm" data-invite-status={inv.state}>
          {inv.state === "open" && (
            <>
              Link created <span className="font-medium">{fmtDateTime(inv.createdAt!)}</span>, expires <span className="font-medium">{fmtDateTime(inv.expiresAt!)}</span>
            </>
          )}
          {inv.state === "expired" && <span className="font-medium text-warn">Expired {inv.expiresAt ? fmtDateTime(inv.expiresAt) : ""}</span>}
          {inv.state === "claimed" && (
            <span className="text-pos">
              Claimed <span className="font-medium">{fmtDateTime(inv.claimedAt!)}</span> with <span className="font-medium">{inv.claimedEmail}</span>
            </span>
          )}
        </div>
      )}
      {shownLink && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-line bg-surface2/60 p-2" data-invite-link>
          <input readOnly value={shownLink} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 bg-transparent px-1.5 font-mono text-xs text-ink outline-none" aria-label="Invite link" />
          <Button size="sm" className="h-10 shrink-0" onClick={async () => toast.show({ message: (await copyText(shownLink)) ? "Invite link copied" : "Select the link and copy it", tone: "success" })} data-copy-link>
            <Copy size={15} /> Copy
          </Button>
        </div>
      )}
      {status !== "active" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" className="h-11" disabled={!!busy} onClick={() => run("invite-link")} data-create-invite>
            <Share2 size={16} /> {busy === "invite-link" ? "Making link…" : inv?.state === "open" ? "Make a new invite link" : "Create invite link"}
          </Button>
          {status === "invited" && resend && (
            <Button size="sm" className="h-11" disabled={!!busy} onClick={() => run("invite-email")} data-email-invite>
              <Send size={16} /> {busy === "invite-email" ? "Sending…" : "Email invite"}
            </Button>
          )}
          {status === "invited" && (
            <Button size="sm" className="h-11" disabled={!!busy} onClick={() => (setTemp(""), setTempOpen(true))} data-temp-password>
              <KeyRound size={16} /> Set temporary password
            </Button>
          )}
        </div>
      )}
      {status === "active" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" className="h-11" disabled={!!busy || resend === false} onClick={() => run("reset-email")} title={resend === false ? "Email is not set up (RESEND_API_KEY)" : undefined}>
            <Mail size={16} /> {busy === "reset-email" ? "Sending…" : "Send password reset"}
          </Button>
          <Button size="sm" className="h-11" disabled={!!busy} onClick={() => (setTemp(""), setTempOpen(true))} data-temp-password>
            <KeyRound size={16} /> Set temporary password
          </Button>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">Passwords are stored scrambled (hashed). Nobody, including you, can see them.</p>
      <Sheet
        open={tempOpen}
        onClose={() => setTempOpen(false)}
        title="Set a temporary password"
        footer={
          <Button
            variant="primary"
            size="lg"
            block
            disabled={temp.length < 8 || !!busy}
            onClick={async () => {
              setTempOpen(false);
              await run("temp-password", { password: temp });
              setTemp("");
            }}
          >
            Set temporary password
          </Button>
        }
      >
        <p className="mb-4 text-sm text-muted">Tell {c.name} this password yourself. When they sign in with it they must choose a new one. It is not shown again or emailed.</p>
        <Field label="Temporary password" hint="At least 8 characters.">
          <Input type="text" autoComplete="off" value={temp} maxLength={200} onChange={(e) => setTemp(e.target.value)} data-temp-input />
        </Field>
      </Sheet>
    </div>
  );
}

export function CreditSection({ c }: { c: CustomerRec }) {
  const s = useLoaded();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [by, setBy] = useState<"A" | "B">("A");
  if (!s) return null;
  const { data, name } = s;
  const entries = (data.creditEntries ?? []).filter((e) => e.customerId === c.id);
  const balance = balanceOf(entries, c.id);
  const pending = pendingOf(entries, c.id);

  async function save() {
    const cents = amount ?? 0;
    if (cents <= 0 || !reason.trim()) return;
    setOpen(false);
    const ok = await s!.mutate(null, () => api(`/api/customers/${c.id}/credit`, "POST", { amountCents: dir === "add" ? cents : -cents, reason: reason.trim(), by: name(by) }));
    if (ok) toast.show({ message: dir === "add" ? `${fmtMoney(cents)} store credit added` : `${fmtMoney(cents)} store credit removed`, tone: "success" });
  }

  return (
    <div className={sectionCls} data-credit-section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={headCls}>
          <Gift size={17} /> Store credit
        </div>
        <div className={cx("text-xl font-semibold tabular-nums", balance < 0 && "text-neg")} data-credit-balance>
          {fmtMoney(balance)}
        </div>
      </div>
      {balance < 0 && (
        <p className="mt-2 rounded-lg bg-neg/10 px-3 py-2 text-sm font-medium text-neg" data-negative-balance>
          Negative balance: referral credit was reversed after it was spent. New credit pays this off first; they can't spend credit until it is positive.
        </p>
      )}
      {pending > 0 && <p className="mt-1 text-sm text-muted" data-credit-pending>Pending referral credit {fmtMoney(pending)} (not spendable until those orders are paid).</p>}
      <p className="mt-1 text-sm text-muted">Used like a discount at checkout. Taken from the balance only when an order is completed (in person) or marked paid (online).</p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" className="h-11" onClick={() => (setDir("add"), setAmount(null), setReason(""), setBy(data.settings.defaultSoldBy), setOpen(true))} data-add-credit>
          Add credit
        </Button>
        <Button size="sm" className="h-11" disabled={balance <= 0} onClick={() => (setDir("remove"), setAmount(null), setReason(""), setBy(data.settings.defaultSoldBy), setOpen(true))}>
          Remove credit
        </Button>
      </div>
      {entries.length > 0 ? (
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line" data-credit-history>
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-3 px-3.5 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {e.reason || (e.kind === "manual" ? "Adjustment" : "Store credit")}
                  {e.pending && (
                    <span className="ml-1.5 align-middle">
                      <Badge tone="warn">Pending</Badge>
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted">
                  {fmtDateTime(e.date)}
                  {e.orderNumber ? ` · order #${e.orderNumber}` : ""}
                  {e.by ? ` · ${e.by}` : ""}
                </div>
              </div>
              <div className={cx("shrink-0 font-semibold tabular-nums", e.amountCents < 0 ? "text-neg" : "text-pos")}>{fmtMoney(e.amountCents, { sign: true })}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">No store credit history yet.</p>
      )}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={dir === "add" ? "Add store credit" : "Remove store credit"}
        footer={
          <Button variant="primary" size="lg" block disabled={!(amount && amount > 0) || !reason.trim() || (dir === "remove" && (amount ?? 0) > balance)} onClick={save}>
            {dir === "add" ? "Add credit" : "Remove credit"}
            {amount ? ` · ${fmtMoney(amount)}` : ""}
          </Button>
        }
      >
        <div className="space-y-4">
          <Segmented
            value={dir}
            onChange={setDir}
            options={[
              { value: "add", label: "Add" },
              { value: "remove", label: "Remove" },
            ]}
          />
          <Field label="Amount" hint={dir === "remove" ? `Up to ${fmtMoney(balance)} (the balance can't go below $0).` : undefined}>
            <MoneyInput value={amount} nullable autoFocus onChange={setAmount} label="credit amount" />
          </Field>
          <Field label="Reason (required)">
            <Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="For example Giveaway" data-credit-reason />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CREDIT_REASONS.map((r) => (
                <button key={r} type="button" className={cx("h-9 rounded-full border px-3 text-sm", reason === r ? "border-accent bg-accent/10 text-accent" : "border-line hover:bg-surface2")} onClick={() => setReason(r)}>
                  {r}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Who is doing this">
            <Segmented
              value={by}
              onChange={setBy}
              options={[
                { value: "A", label: name("A") },
                { value: "B", label: name("B") },
              ]}
            />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}

export function ReferralSection({ c }: { c: CustomerRec }) {
  const s = useLoaded();
  const toast = useToast();
  if (!s) return null;
  const { data, mutate } = s;
  const referrer = c.referredById ? data.customers.find((x) => x.id === c.referredById) : undefined;
  const referred = data.customers.filter((x) => x.referredById === c.id).sort((a, b) => a.name.localeCompare(b.name));
  const earned = (data.creditEntries ?? []).filter((e) => e.customerId === c.id && e.kind === "referral" && !e.pending).reduce((x, e) => x + e.amountCents, 0);
  const uses = [...data.orders, ...(data.pendingOrders ?? [])].filter((o) => o.referredById === c.id).length;
  const shown = c.referralCodeDisplay || c.referralCode || "";

  async function setReferrer(id: string | null) {
    const ok = await mutate(
      (d) => ({ ...d, customers: d.customers.map((x) => (x.id === c.id ? { ...x, referredById: id } : x)) }),
      () => api(`/api/customers/${c.id}`, "PATCH", { referredById: id }),
    );
    if (ok) toast.show({ message: id ? "Referred by saved" : "Referred by cleared" });
  }

  return (
    <div className={sectionCls} data-referral-section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={headCls}>
          <Share2 size={17} /> Referrals
        </div>
        {shown && (
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-2.5 font-mono text-sm font-semibold tracking-wider hover:bg-surface2"
            onClick={async () => (await copyText(shown)) && toast.show({ message: "Referral code copied" })}
            title="Copy referral code"
            data-referral-code
          >
            {shown} <Copy size={14} />
          </button>
        )}
      </div>
      <CodeEditor c={c} />
      <div className="mt-2 text-sm">
        <Link href={`/admin/referrals/${c.id}`} className="font-medium text-accent underline underline-offset-4" data-referral-details>
          Referral details: {uses} use{uses === 1 ? "" : "s"}, code history and ledger
        </Link>
      </div>
      <div className="mt-3">
        <Field label="Referred by" hint={referrer ? "For your records only." : "For your records only. Orders earn referral credit only when a code is used on that order (or a referrer is picked on the Sell screen)."}>
          <ReferrerPicker value={c.referredById} exclude={c.id} onChange={setReferrer} />
        </Field>
      </div>
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-sm">
          <span className="font-medium">People they referred ({referred.length})</span>
          <span className="text-muted">
            Earned <span className="font-semibold text-ink tabular-nums" data-referral-earned>{fmtMoney(earned)}</span>
          </span>
        </div>
        {referred.length === 0 ? (
          <p className="text-sm text-muted">Nobody yet. Share the code above.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {referred.map((x) => (
              <li key={x.id} className="rounded-full border border-line px-3 py-1 text-sm">
                {x.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Admin: change a customer's referral code. Same rules as the customer's own page (format, blocked words, unique). */
function CodeEditor({ c }: { c: CustomerRec }) {
  const s = useLoaded();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const p = codeProblem(code);
    if (p) return setMsg(code ? CODE_PROBLEM_TEXT[p] : "");
    setMsg("");
    const t = setTimeout(async () => {
      const r = (await api(`/api/customers/${c.id}/referral-code`, "POST", { code, check: true }).catch(() => null)) as { message?: string } | null;
      if (r?.message) setMsg(r.message);
    }, 350);
    return () => clearTimeout(t);
  }, [code, open, c.id]);
  if (!s) return null;
  async function save() {
    setBusy(true);
    const ok = await s!.mutate(null, () => api(`/api/customers/${c.id}/referral-code`, "POST", { code, by: s!.name(s!.data.settings.defaultSoldBy) }));
    setBusy(false);
    if (ok) {
      toast.show({ message: `Referral code changed to ${code.trim()}`, tone: "success" });
      setOpen(false);
    }
  }
  if (!open) {
    return (
      <button type="button" className="mt-2 text-sm font-medium text-muted underline underline-offset-4 hover:text-ink" onClick={() => (setCode(c.referralCodeDisplay || c.referralCode || ""), setOpen(true))} data-edit-referral-code>
        Change code
      </button>
    );
  }
  return (
    <div className="mt-3 space-y-2" data-referral-code-editor>
      <div className="flex gap-2">
        <Input value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} aria-label="New referral code" className="font-mono" />
        <Button size="sm" className="h-12 shrink-0" disabled={busy || !!msg || !code.trim()} onClick={save}>
          Save
        </Button>
        <Button size="sm" variant="soft" className="h-12 shrink-0" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className={cx("text-xs", msg ? "text-neg" : "text-muted")}>{msg || "3 to 20 letters, numbers or dashes. The old code stops working at once; earned credit stays."}</p>
    </div>
  );
}
