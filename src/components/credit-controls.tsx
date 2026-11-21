"use client";

// Store credit and "Referred by" controls, shared by the Sell cart, order editing and the customer page.
import { useState } from "react";
import { Gift, Search, UserPlus, X } from "lucide-react";
import { availableCredit, balanceOf, reservedCredit } from "@/lib/credit";
import { searchCustomers } from "@/lib/customers";
import { fmtMoney, uid } from "@/lib/format";
import type { AppData, CustomerRec } from "@/lib/types";
import { api, useLoaded } from "./store";
import { useToast } from "./toast";
import { Button, Input, MoneyInput, cx } from "./ui";

/**
 * What a customer can spend on this order: balance minus what other open orders hold.
 * `ownUsed`: credit this same order already took from the balance (editing a completed order).
 */
export function creditFor(data: AppData, customerId: string | null | undefined, orderId: string, ownUsed = 0) {
  const balance = balanceOf(data.creditEntries ?? [], customerId);
  const reserved = reservedCredit(data, customerId, orderId);
  return { balance, available: availableCredit(balance + ownUsed, reserved) };
}

/**
 * "Store credit: $X available", apply all or a custom amount, and the live "Credit used / remaining" line.
 * `max` is the most this order can take (available credit, and never more than the total after discounts).
 */
export function StoreCreditControl({ available, max, value, onChange }: { available: number; max: number; value: number; onChange: (cents: number) => void }) {
  const [custom, setCustom] = useState(false);
  const used = Math.min(value, max);
  const all = used > 0 && used === max;
  const chip = "h-11 rounded-xl border px-3.5 text-sm font-medium tabular-nums transition active:scale-95";
  return (
    <div data-store-credit className="rounded-2xl border border-line px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Gift size={17} className="text-accent" /> Store credit: <span data-credit-available className="tabular-nums">{fmtMoney(available)}</span> available
        </div>
      </div>
      {available > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button type="button" data-apply-credit aria-pressed={all && !custom} disabled={max <= 0} className={cx(chip, all && !custom ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface hover:bg-surface2")} onClick={() => (setCustom(false), onChange(max))}>
            Apply all{max < available ? ` (${fmtMoney(max)})` : ""}
          </button>
          {custom ? (
            <MoneyInput className="w-40" label="store credit" autoFocus value={value} min={0} max={max} onChange={(c) => onChange(Math.max(0, Math.min(max, c ?? 0)))} />
          ) : (
            <button type="button" className={cx(chip, "border-line bg-surface hover:bg-surface2")} onClick={() => setCustom(true)}>
              Custom amount
            </button>
          )}
          {value > 0 && (
            <button type="button" className={cx(chip, "border-line bg-surface text-muted hover:bg-surface2")} onClick={() => (setCustom(false), onChange(0))}>
              Don’t use
            </button>
          )}
        </div>
      )}
      {used > 0 && (
        <p data-credit-live className="mt-2 text-sm text-muted">
          Credit used <span className="font-semibold text-ink tabular-nums">{fmtMoney(used)}</span>, remaining after this order <span className="font-semibold text-ink tabular-nums">{fmtMoney(available - used)}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Pick who referred a customer or a sale: search existing customers, or add a new one (name, email, phone)
 * right here. A new customer is saved at once (with an email they become an invited account).
 */
export function ReferrerPicker({ value, exclude, onChange }: { value: string | null | undefined; exclude?: string | null; onChange: (id: string | null) => void }) {
  const s = useLoaded();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  if (!s) return null;
  const { data, mutate } = s;
  const picked = value ? data.customers.find((c) => c.id === value) : undefined;
  const pool = data.customers.filter((c) => c.id !== exclude);
  const matches = q.trim() ? searchCustomers(pool, q).slice(0, 6) : [];

  async function create() {
    const name = f.name.trim();
    if (!name) return;
    setBusy(true);
    const id = uid();
    let rec: CustomerRec | null = null;
    const ok = await mutate(null, async () => {
      rec = await api<CustomerRec>("/api/customers", "POST", { id, name, email: f.email.trim(), phone: f.phone.trim(), notes: "" });
    });
    setBusy(false);
    if (!ok || !rec) return;
    onChange(id);
    setAdding(false);
    setQ("");
    setF({ name: "", email: "", phone: "" });
    toast.show({ message: f.email.trim() ? `${name} added. They have an invited account; send the invite from Customers.` : `${name} added` });
  }

  if (picked) {
    return (
      <div className="flex h-12 items-center justify-between gap-2 rounded-xl border border-line bg-surface pl-3.5 pr-1.5" data-referrer={picked.name}>
        <span className="truncate font-medium">{picked.name}</span>
        <button type="button" aria-label="Clear referred by" onClick={() => onChange(null)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface2 hover:text-ink">
          <X size={16} />
        </button>
      </div>
    );
  }

  if (adding) {
    return (
      <div className="space-y-2 rounded-xl border border-line p-3" data-new-referrer>
        <Input autoFocus placeholder="Name" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="New customer name" />
        <Input type="email" placeholder="Email (optional)" value={f.email} maxLength={200} onChange={(e) => setF({ ...f, email: e.target.value })} aria-label="New customer email" />
        <Input type="tel" placeholder="Phone (optional)" value={f.phone} maxLength={40} onChange={(e) => setF({ ...f, phone: e.target.value })} aria-label="New customer phone" />
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" disabled={!f.name.trim() || busy} onClick={create}>
            {busy ? "Adding…" : "Add customer"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <Input value={q} onChange={(e) => (setQ(e.target.value), setOpen(true))} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} placeholder="Search customers" autoComplete="off" className="pl-10" aria-label="Referred by" />
      </div>
      {open && (
        <div className="mt-1.5 overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
          {matches.map((c) => (
            <button key={c.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (onChange(c.id), setQ(""), setOpen(false))} className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-[15px] hover:bg-surface2">
              <span className="truncate font-medium">{c.name}</span>
              {c.phone && <span className="shrink-0 text-xs tabular-nums text-muted">{c.phone}</span>}
            </button>
          ))}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (setF({ name: q.trim(), email: "", phone: "" }), setAdding(true), setOpen(false))}
            className={cx("flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[15px] font-medium text-accent hover:bg-surface2", matches.length > 0 && "border-t border-line")}
            data-add-referrer
          >
            <UserPlus size={16} /> New customer{q.trim() ? ` “${q.trim()}”` : ""}
          </button>
        </div>
      )}
    </div>
  );
}
