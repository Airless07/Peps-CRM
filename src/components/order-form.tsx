"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Crown, X } from "lucide-react";
import { orderTotals } from "@/lib/money";
import type { Draft, DraftLine } from "@/lib/draft";
import { colorHex, fmtMoney, fromLocalInput, toLocalDateTimeInput, uid } from "@/lib/format";
import { withSize } from "@/lib/size";
import { discountButtonLabel, isDiscountButtonOn, tapDiscountButton, tapTipButton, tipButtonLabel } from "@/lib/sell-buttons";
import { dealLineOff, isDealLine, sellDealHints } from "@/lib/bogo";
import { isCash } from "@/lib/cash";
import { ownerLine, setOwnerPrice, zeroCostLines } from "@/lib/owner";
import { heldBy } from "@/lib/saved-orders";
import { recentCustomers } from "@/lib/sell-tools";
import type { DiscountType, Partner } from "@/lib/types";
import { Button, Field, Input, MoneyInput, NumberInput, Row, Segmented, Select, Sheet, Stepper, cx, useConfirm } from "./ui";
import { useLoaded } from "./store";
import { CustomerPicker } from "./customer-picker";
import { ReferrerPicker, StoreCreditControl, creditFor } from "./credit-controls";

const chip =
  "h-10 rounded-xl border px-3.5 text-sm font-medium tabular-nums transition active:scale-95";
const chipOn = "border-accent bg-accent/10 text-accent";
const chipOff = "border-line bg-surface text-ink hover:bg-surface2";

export function OrderForm({ draft, onChange, mode }: { draft: Draft; onChange: (d: Draft) => void; mode: "cart" | "edit" }) {
  const s = useLoaded();
  const confirm = useConfirm();
  const [customTip, setCustomTip] = useState(false);
  const [askOwner, setAskOwner] = useState(false);
  // Store credit this order may use: the customer's free credit, and never more than the total after discounts.
  const linkedCustomer = s && draft.customerId ? s.data.customers.find((c) => c.id === draft.customerId) : undefined;
  const editingCounted = mode === "edit" && s ? s.data.orders.find((o) => o.id === draft.id) : undefined;
  const credit = s && linkedCustomer && !draft.owner ? creditFor(s.data, linkedCustomer.id, draft.id, editingCounted && editingCounted.customerId === linkedCustomer.id ? editingCounted.storeCreditCents ?? 0 : 0) : null;
  const pre = orderTotals({ ...draft, storeCreditCents: 0 });
  const creditMax = credit ? Math.max(0, Math.min(credit.available, pre.subtotal - pre.discount)) : 0;
  const creditWanted = draft.storeCreditCents ?? 0;
  useEffect(() => {
    // Items removed, a bigger discount, another customer: never use more than the order can take.
    if (creditWanted > creditMax) onChange({ ...draft, storeCreditCents: creditMax });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditWanted, creditMax]);
  if (!s) return null;
  const { data, ledger, name } = s;
  const totals = orderTotals(draft);
  const owner = draft.owner ?? null;
  const productColor = (pid: string | null) => colorHex(data.products.find((p) => p.id === pid)?.color ?? "slate");
  const costOf = (pid: string) => ledger.stock.get(pid)?.unitCost;
  const priceOf = (pid: string) => data.products.find((p) => p.id === pid)?.defaultPriceCents;

  const setLine = (id: string, patch: Partial<DraftLine>) =>
    onChange({ ...draft, lines: draft.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const removeLine = (id: string) => onChange({ ...draft, lines: draft.lines.filter((l) => l.id !== id) });
  const addLine = (pid: string) => {
    const p = data.products.find((x) => x.id === pid);
    if (!p) return;
    const line: DraftLine = {
      id: uid(),
      productId: p.id,
      productName: withSize(p.name, p.variantLabel),
      quantity: 1,
      unitPriceCents: p.defaultPriceCents,
      unitCostCents: ledger.stock.get(p.id)?.unitCost ?? 0,
      cutPercent: data.settings.businessCutPercent,
    };
    onChange({ ...draft, lines: [...draft.lines, owner ? ownerLine(line, costOf) : line] });
  };

  /** Owner price on for a partner, after a warning when an item has no cost set. */
  async function ownerOn(p: Partner) {
    setAskOwner(false);
    const free = zeroCostLines(draft.lines, costOf);
    if (free.length > 0) {
      const ok = await confirm({
        title: "No cost set",
        body: `${free.join(", ")} ${free.length === 1 ? "has" : "have"} no cost per unit ($0), so owner price would charge $0 for ${free.length === 1 ? "it" : "them"}. Set the cost in Inventory first, or continue anyway.`,
        confirmText: "Use owner price anyway",
      });
      if (!ok) return;
    }
    setCustomTip(false);
    onChange(setOwnerPrice(draft, p, { costOf, priceOf }));
  }

  const setDiscount = (type: DiscountType, value: number) => onChange({ ...draft, discountType: type, discountValue: value });
  // Quick buttons: exactly the ones set in Settings, in that order.
  const { discounts: discountButtons, tips: tipPresets } = data.settings.sellButtons;
  const tipIsPreset = tipPresets.includes(draft.tipCents);
  // Offered methods, plus the order's own one if it is no longer offered (or "Unknown")
  const methods = data.settings.paymentMethods.includes(draft.paymentMethod)
    ? data.settings.paymentMethods
    : [...data.settings.paymentMethods, draft.paymentMethod];

  // Stock left for each product after this order (a saved order's own held units count as available).
  const saved = data.savedOrders.find((o) => o.id === draft.id) ?? null;
  const editingOrder = mode === "edit" ? data.orders.find((o) => o.id === draft.id) : undefined;
  const inDraft = (pid: string) => draft.lines.filter((l) => l.productId === pid).reduce((x, l) => x + l.quantity, 0);
  const stockLeft = (pid: string) => {
    const already = editingOrder ? editingOrder.lines.filter((l) => l.productId === pid).reduce((x, l) => x + l.quantity, 0) : 0;
    return (ledger.stock.get(pid)?.stock ?? 0) + heldBy(saved, pid) + already - inDraft(pid);
  };

  const names = {
    listing: (id: string) => data.listings.find((l) => l.id === id)?.name,
    variant: (id: string) => {
      const p = data.products.find((x) => x.id === id);
      return p ? withSize(p.name, p.variantLabel) : undefined;
    },
  };
  const hints = mode === "cart" ? sellDealHints(draft, { promotions: data.promotions, products: data.products, names }) : [];
  const recent = mode === "cart" && !draft.customer.trim() ? recentCustomers(data, 5) : [];
  const cash = isCash(draft.paymentMethod);
  const cashTo: Partner = draft.cashTo ?? (draft.soldBy === "B" ? "B" : "A");
  const dealOff = draft.lines.reduce((x, l) => x + dealLineOff(l), 0);
  const ownerFull = owner ? draft.lines.reduce((x, l) => x + (l.fullPriceCents ?? l.unitPriceCents) * l.quantity, 0) : 0;

  return (
    <div className="space-y-6">
      {owner && (
        <div data-owner-tag className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-accent/40 bg-accent/10 px-3.5 py-2.5">
          <Crown size={18} className="shrink-0 text-accent" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-semibold text-accent">Owner price: {name(owner)}</div>
            <div className="text-muted">Charged at cost. $0 profit, nothing to split. Discounts, tips and deals are off.</div>
          </div>
          {mode === "cart" && (
            <Button size="sm" className="h-10" onClick={() => onChange(setOwnerPrice(draft, null, { costOf, priceOf }))}>
              Turn off
            </Button>
          )}
        </div>
      )}

      {mode === "edit" && (
        <Field label="Date & time">
          <Input
            type="datetime-local"
            value={toLocalDateTimeInput(draft.date)}
            onChange={(e) => e.target.value && onChange({ ...draft, date: fromLocalInput(e.target.value) })}
          />
        </Field>
      )}

      {/* Lines */}
      <div>
        <div className="divide-y divide-line">
          {draft.lines.map((l) =>
            isDealLine(l) ? (
              <DealRow key={l.id} line={l} color={productColor(l.productId)} onRemove={() => removeLine(l.id)} />
            ) : (
              <LineRow
                key={l.id}
                line={l}
                color={productColor(l.productId)}
                mode={mode}
                owner={!!owner}
                stockNote={mode === "cart" && l.productId && stockLeft(l.productId) < 0 ? `Only ${Math.max(0, stockLeft(l.productId) + inDraft(l.productId))} in stock` : null}
                onChange={(patch) => setLine(l.id, patch)}
                onRemove={() => removeLine(l.id)}
              />
            ),
          )}
        </div>
        {draft.lines.length === 0 && <p className="py-4 text-center text-sm text-muted">No items yet.</p>}
        {hints.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {hints.map((h) => (
              <li key={h.dealId} data-deal-hint className="rounded-xl bg-accent/10 px-3.5 py-2 text-sm font-medium text-accent">
                {h.text}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <Select value="" onChange={(e) => e.target.value && addLine(e.target.value)} aria-label="Add item" className="h-11 text-[15px] text-muted">
            <option value="">+ Add item…</option>
            {data.products
              .filter((p) => !p.archived)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {fmtMoney(p.defaultPriceCents)}
                </option>
              ))}
          </Select>
        </div>
      </div>

      {/* Discount (hidden with owner price) */}
      {!owner && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-muted">Discount</span>
            <Segmented
              size="sm"
              className="w-28"
              value={draft.discountType}
              onChange={(t) => setDiscount(t, 0)}
              options={[
                { value: "$", label: "$" },
                { value: "%", label: "%" },
              ]}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {draft.discountType === "$" ? (
              <MoneyInput className="w-44" label="discount" value={draft.discountValue} onChange={(c) => setDiscount("$", c ?? 0)} />
            ) : (
              <NumberInput className="w-44" label="discount" value={draft.discountValue} min={0} max={100} step={0.5} suffix="%" onChange={(n) => setDiscount("%", n ?? 0)} />
            )}
            {discountButtons.map((b) => (
              <button
                key={b.type + b.value}
                type="button"
                data-quick-discount
                aria-pressed={isDiscountButtonOn(draft, b)}
                className={cx(chip, "h-12", isDiscountButtonOn(draft, b) ? chipOn : chipOff)}
                onClick={() => onChange(tapDiscountButton(draft, b))}
              >
                {discountButtonLabel(b)}
              </button>
            ))}
            {mode === "cart" && (
              <button type="button" data-owner-price className={cx(chip, "h-12 inline-flex items-center gap-1.5", chipOff)} onClick={() => setAskOwner(true)}>
                <Crown size={16} /> Owner price
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tip (hidden with owner price) */}
      {!owner && (
        <div>
          <span className="mb-2 block text-sm font-medium text-muted">Tip</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={cx(chip, "h-12", draft.tipCents === 0 && !customTip ? chipOn : chipOff)} onClick={() => { setCustomTip(false); onChange({ ...draft, tipCents: 0 }); }}>
              None
            </button>
            {tipPresets.map((c) => (
              <button
                key={c}
                type="button"
                data-quick-tip
                className={cx(chip, "h-12", draft.tipCents === c && !customTip ? chipOn : chipOff)}
                onClick={() => {
                  setCustomTip(false);
                  onChange(tapTipButton(draft, c));
                }}
              >
                {tipButtonLabel(c)}
              </button>
            ))}
            {customTip || (!tipIsPreset && draft.tipCents > 0) ? (
              <MoneyInput className="w-44" label="tip" autoFocus={customTip} value={draft.tipCents} onChange={(c) => onChange({ ...draft, tipCents: c ?? 0 })} />
            ) : (
              <button type="button" className={cx(chip, "h-12", chipOff)} onClick={() => setCustomTip(true)}>
                Custom
              </button>
            )}
          </div>
        </div>
      )}

      {/* Seller, payment, customer, note */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Field label="Sold by">
            <Segmented
              value={draft.soldBy}
              onChange={(v) => onChange({ ...draft, soldBy: v })}
              options={[
                { value: "A", label: name("A") },
                { value: "B", label: name("B") },
                ...(draft.soldBy === "W" ? [{ value: "W" as const, label: name("W") }] : []),
              ]}
            />
          </Field>
          <Field label="Payment">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Payment method">
              {methods.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={draft.paymentMethod === m}
                  className={cx(chip, "h-11", draft.paymentMethod === m ? chipOn : chipOff)}
                  onClick={() => onChange({ ...draft, paymentMethod: m })}
                >
                  {m}
                </button>
              ))}
            </div>
          </Field>
        </div>
        {cash && draft.soldBy !== "W" && (
          <Field label="Cash received by" hint="Who is holding this cash now. Shows on the Money page under Cash held.">
            <Segmented<Partner>
              value={cashTo}
              onChange={(v) => onChange({ ...draft, cashTo: v })}
              options={[
                { value: "A", label: name("A") },
                { value: "B", label: name("B") },
              ]}
            />
          </Field>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Customer (optional)">
            <CustomerPicker
              name={draft.customer}
              customerId={draft.customerId}
              customers={data.customers}
              onChange={(v) => {
                const c = v.customerId ? data.customers.find((x) => x.id === v.customerId) : undefined;
                const changed = v.customerId !== draft.customerId;
                onChange({
                  ...draft,
                  ...v,
                  // Credit belongs to one customer: picking another starts at none.
                  storeCreditCents: changed ? 0 : draft.storeCreditCents ?? 0,
                  // No lock-in: a referrer is picked for each order (never filled in from an earlier one).
                  referredById: draft.referredById && draft.referredById !== v.customerId ? draft.referredById : null,
                });
              }}
            />
            {recent.length > 0 && (
              <div data-recent-customers className="mt-2 flex flex-wrap gap-1.5">
                {recent.map((c) => (
                  <button key={c.id} type="button" className="h-10 max-w-[12rem] truncate rounded-full border border-line px-3 text-sm font-medium text-ink transition hover:bg-surface2 active:scale-95" onClick={() => onChange({ ...draft, customer: c.name, customerId: c.id, storeCreditCents: 0, referredById: draft.referredById && draft.referredById !== c.id ? draft.referredById : null })}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </Field>
          <Field label="Note (optional)">
            <Input value={draft.note} onChange={(e) => onChange({ ...draft, note: e.target.value })} placeholder="Anything to remember" />
          </Field>
        </div>
        {credit && <StoreCreditControl available={credit.available} max={creditMax} value={Math.min(creditWanted, creditMax)} onChange={(c) => onChange({ ...draft, storeCreditCents: c })} />}
        <Field label="Referred by (optional)" hint={owner ? "Owner price orders earn no referral credit." : `Earns ${data.store.referrals.percent}% of this order in store credit when it is completed.`}>
          <ReferrerPicker value={draft.referredById} exclude={draft.customerId} onChange={(id) => onChange({ ...draft, referredById: id })} />
        </Field>
      </div>

      {/* Breakdown */}
      <div className="rounded-2xl bg-surface2/70 px-4 py-3">
        {owner ? (
          <>
            <Row label="Normal price">
              <s className="text-muted">{fmtMoney(ownerFull)}</s>
            </Row>
            <Row label={<span className="text-accent">Owner price (at cost)</span>}>{fmtMoney(totals.subtotal)}</Row>
          </>
        ) : (
          <Row label="Subtotal">{fmtMoney(totals.subtotal + dealOff)}</Row>
        )}
        {dealOff > 0 && (
          <Row label={<span className="text-neg">BOGO deals</span>}>
            <span className="text-neg">-{fmtMoney(dealOff)}</span>
          </Row>
        )}
        {totals.discount > 0 && (
          <Row label={<span className="text-neg">Discount{draft.discountType === "%" ? ` (${draft.discountValue}%)` : ""}</span>}>
            <span className="text-neg">-{fmtMoney(totals.discount)}</span>
          </Row>
        )}
        {totals.credit > 0 && (
          <Row label={<span className="text-neg">Store credit</span>}>
            <span className="text-neg">-{fmtMoney(totals.credit)}</span>
          </Row>
        )}
        {totals.tip > 0 && <Row label="Tip">{fmtMoney(totals.tip)}</Row>}
        <div className="my-1.5 border-t border-line" />
        <Row label="Total" strong>
          {fmtMoney(totals.total)}
        </Row>
      </div>

      <Sheet open={askOwner} onClose={() => setAskOwner(false)} title="Who is this for?">
        <p className="mb-4 text-sm text-muted">Owner price charges every item at its cost per unit. Profit is $0, nothing goes to the split, and all of it stays in business money. Stock goes down like a normal sale.</p>
        <div className="grid grid-cols-2 gap-3" data-owner-pick>
          {(["A", "B"] as const).map((p) => (
            <Button key={p} size="lg" variant="soft" onClick={() => ownerOn(p)}>
              {name(p)}
            </Button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

/** A BOGO line: the discounted units of an item, read-only (the deal decides them). */
function DealRow({ line, color, onRemove }: { line: DraftLine; color: string; onRemove: () => void }) {
  const off = dealLineOff(line);
  return (
    <div className="py-3" data-deal-line>
      <div className="flex items-center gap-2.5">
        <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            <span className="mr-1.5 rounded-md bg-accent/15 px-1.5 py-0.5 text-xs font-semibold text-accent">BOGO</span>
            {line.quantity > 1 ? `${line.quantity}× ` : ""}
            {line.productName || "Deleted product"}
          </div>
          <div className="truncate text-xs text-muted">{line.dealName}</div>
        </div>
        <div className="text-right text-sm font-medium tabular-nums text-neg">-{fmtMoney(off)}</div>
        <button type="button" aria-label="Remove the BOGO item" onClick={onRemove} className="-mr-2 flex h-10 w-8 items-center justify-center text-muted transition hover:text-neg">
          <X size={18} />
        </button>
      </div>
    </div>
  );
}

function LineRow({
  line,
  color,
  mode,
  owner,
  stockNote,
  onChange,
  onRemove,
}: {
  line: DraftLine;
  color: string;
  mode: "cart" | "edit";
  owner: boolean;
  /** "Only 2 in stock" when the order needs more than there is (cart only). */
  stockNote: string | null;
  onChange: (p: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const [editPrice, setEditPrice] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  return (
    <div className="py-3">
      <div className="flex items-center gap-2.5">
        <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{line.productName || "Deleted product"}</div>
          {owner ? (
            <div className="whitespace-nowrap text-sm text-muted" data-owner-line>
              {line.fullPriceCents != null && line.fullPriceCents !== line.unitPriceCents && <s className="mr-1.5">{fmtMoney(line.fullPriceCents)}</s>}
              <span className="font-medium text-accent">{fmtMoney(line.unitPriceCents)}</span> each
            </div>
          ) : editPrice ? (
            <MoneyInput
              className="mt-1 w-full max-w-[11rem]"
              autoFocus
              value={line.unitPriceCents}
              onChange={(c) => onChange({ unitPriceCents: c ?? 0 })}
            />
          ) : (
            <button type="button" className="whitespace-nowrap text-sm text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setEditPrice(true)}>
              {fmtMoney(line.unitPriceCents)} each
            </button>
          )}
          {stockNote && (
            <div data-stock-warning className="text-xs font-medium text-warn">
              {stockNote}
            </div>
          )}
        </div>
        <Stepper value={line.quantity} onChange={(q) => onChange({ quantity: q })} />
        <div className="w-[68px] text-right font-medium tabular-nums">{fmtMoney(line.quantity * line.unitPriceCents)}</div>
        <button type="button" aria-label="Remove item" onClick={onRemove} className="-mr-2 flex h-10 w-8 items-center justify-center text-muted transition hover:text-neg">
          <X size={18} />
        </button>
      </div>
      {editPrice && !owner && (
        <button type="button" className="ml-[18px] mt-1 text-xs font-medium text-accent" onClick={() => setEditPrice(false)}>
          Done
        </button>
      )}
      {mode === "edit" && (
        <div className="ml-[18px] mt-1">
          <button type="button" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink" onClick={() => setAdvanced((v) => !v)}>
            Cost {fmtMoney(line.unitCostCents)} · Cut {line.cutPercent}%
            <ChevronDown size={14} className={cx("transition", advanced && "rotate-180")} />
          </button>
          {advanced && (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Field label="Unit cost">
                <MoneyInput value={line.unitCostCents} onChange={(c) => onChange(owner ? { unitCostCents: c ?? 0, unitPriceCents: c ?? 0 } : { unitCostCents: c ?? 0 })} />
              </Field>
              <Field label="Business cut">
                <NumberInput value={line.cutPercent} min={0} max={100} step={0.5} suffix="%" onChange={(n) => onChange({ cutPercent: n ?? 0 })} />
              </Field>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
