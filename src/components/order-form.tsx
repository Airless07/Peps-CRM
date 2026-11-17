"use client";

import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { orderTotals } from "@/lib/money";
import type { Draft, DraftLine } from "@/lib/draft";
import { colorHex, fmtMoney, fromLocalInput, toLocalDateTimeInput, uid } from "@/lib/format";
import { discountButtonLabel, isDiscountButtonOn, tapDiscountButton, tapTipButton, tipButtonLabel } from "@/lib/sell-buttons";
import type { DiscountType } from "@/lib/types";
import { Field, Input, MoneyInput, NumberInput, Row, Segmented, Select, Stepper, cx } from "./ui";
import { useLoaded } from "./store";
import { CustomerPicker } from "./customer-picker";

const chip =
  "h-10 rounded-xl border px-3.5 text-sm font-medium tabular-nums transition active:scale-95";
const chipOn = "border-accent bg-accent/10 text-accent";
const chipOff = "border-line bg-surface text-ink hover:bg-surface2";

export function OrderForm({ draft, onChange, mode }: { draft: Draft; onChange: (d: Draft) => void; mode: "cart" | "edit" }) {
  const s = useLoaded();
  const [customTip, setCustomTip] = useState(false);
  if (!s) return null;
  const { data, ledger, name } = s;
  const totals = orderTotals(draft);
  const productColor = (pid: string | null) => colorHex(data.products.find((p) => p.id === pid)?.color ?? "slate");

  const setLine = (id: string, patch: Partial<DraftLine>) =>
    onChange({ ...draft, lines: draft.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const removeLine = (id: string) => onChange({ ...draft, lines: draft.lines.filter((l) => l.id !== id) });
  const addLine = (pid: string) => {
    const p = data.products.find((x) => x.id === pid);
    if (!p) return;
    onChange({
      ...draft,
      lines: [
        ...draft.lines,
        {
          id: uid(),
          productId: p.id,
          productName: p.name,
          quantity: 1,
          unitPriceCents: p.defaultPriceCents,
          unitCostCents: ledger.stock.get(p.id)?.unitCost ?? 0,
          cutPercent: data.settings.businessCutPercent,
        },
      ],
    });
  };

  const setDiscount = (type: DiscountType, value: number) => onChange({ ...draft, discountType: type, discountValue: value });
  // Quick buttons: exactly the ones set in Settings, in that order.
  const { discounts: discountButtons, tips: tipPresets } = data.settings.sellButtons;
  const tipIsPreset = tipPresets.includes(draft.tipCents);
  // Offered methods, plus the order's own one if it is no longer offered (or "Unknown")
  const methods = data.settings.paymentMethods.includes(draft.paymentMethod)
    ? data.settings.paymentMethods
    : [...data.settings.paymentMethods, draft.paymentMethod];

  return (
    <div className="space-y-6">
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
          {draft.lines.map((l) => (
            <LineRow
              key={l.id}
              line={l}
              color={productColor(l.productId)}
              mode={mode}
              onChange={(patch) => setLine(l.id, patch)}
              onRemove={() => removeLine(l.id)}
            />
          ))}
        </div>
        {draft.lines.length === 0 && <p className="py-4 text-center text-sm text-muted">No items yet.</p>}
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

      {/* Discount */}
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
            <MoneyInput className="w-32" value={draft.discountValue} onChange={(c) => setDiscount("$", c ?? 0)} />
          ) : (
            <NumberInput className="w-28" value={draft.discountValue} min={0} max={100} step={0.5} suffix="%" onChange={(n) => setDiscount("%", n ?? 0)} />
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
        </div>
      </div>

      {/* Tip */}
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
            <MoneyInput className="w-32" autoFocus={customTip} value={draft.tipCents} onChange={(c) => onChange({ ...draft, tipCents: c ?? 0 })} />
          ) : (
            <button type="button" className={cx(chip, "h-12", chipOff)} onClick={() => setCustomTip(true)}>
              Custom
            </button>
          )}
        </div>
      </div>

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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Customer (optional)">
            <CustomerPicker
              name={draft.customer}
              customerId={draft.customerId}
              customers={data.customers}
              onChange={(v) => onChange({ ...draft, ...v })}
            />
          </Field>
          <Field label="Note (optional)">
            <Input value={draft.note} onChange={(e) => onChange({ ...draft, note: e.target.value })} placeholder="Anything to remember" />
          </Field>
        </div>
      </div>

      {/* Breakdown */}
      <div className="rounded-2xl bg-surface2/70 px-4 py-3">
        <Row label="Subtotal">{fmtMoney(totals.subtotal)}</Row>
        {totals.discount > 0 && (
          <Row label={<span className="text-neg">Discount{draft.discountType === "%" ? ` (${draft.discountValue}%)` : ""}</span>}>
            <span className="text-neg">-{fmtMoney(totals.discount)}</span>
          </Row>
        )}
        {totals.tip > 0 && <Row label="Tip">{fmtMoney(totals.tip)}</Row>}
        <div className="my-1.5 border-t border-line" />
        <Row label="Total" strong>
          {fmtMoney(totals.total)}
        </Row>
      </div>
    </div>
  );
}

function LineRow({
  line,
  color,
  mode,
  onChange,
  onRemove,
}: {
  line: DraftLine;
  color: string;
  mode: "cart" | "edit";
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
          {editPrice ? (
            <MoneyInput
              className="mt-1 w-32"
              autoFocus
              value={line.unitPriceCents}
              onChange={(c) => onChange({ unitPriceCents: c ?? 0 })}
            />
          ) : (
            <button type="button" className="whitespace-nowrap text-sm text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setEditPrice(true)}>
              {fmtMoney(line.unitPriceCents)} each
            </button>
          )}
        </div>
        <Stepper value={line.quantity} onChange={(q) => onChange({ quantity: q })} />
        <div className="w-[68px] text-right font-medium tabular-nums">{fmtMoney(line.quantity * line.unitPriceCents)}</div>
        <button type="button" aria-label="Remove item" onClick={onRemove} className="-mr-2 flex h-10 w-8 items-center justify-center text-muted transition hover:text-neg">
          <X size={18} />
        </button>
      </div>
      {editPrice && (
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
                <MoneyInput value={line.unitCostCents} onChange={(c) => onChange({ unitCostCents: c ?? 0 })} />
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
