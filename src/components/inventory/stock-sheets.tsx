"use client";

// Restock and stock adjustment sheets (unchanged behavior from the original Inventory screen).
import { useEffect, useState } from "react";
import { api, useLoaded } from "@/components/store";
import { MoneyToPicker } from "@/components/money-to";
import { Button, Field, Input, MoneyInput, NumberInput, Segmented, Select, Sheet, Toggle, useConfirm } from "@/components/ui";
import { fmtMoney, fromLocalInput, toLocalDateInput, uid } from "@/lib/format";
import type { AdjustmentReason, AdjustmentRec, PurchaseRec } from "@/lib/types";

// ---------------------------------------------------------------- Restock sheet
export function RestockSheet({ value, onClose }: { value: PurchaseRec | null; onClose: () => void }) {
  const s = useLoaded();
  const confirm = useConfirm();
  const [p, setP] = useState<PurchaseRec | null>(value);
  useEffect(() => setP(value), [value]);
  if (!s) return null;
  const isNew = !value?.id;
  const perUnit = p && p.quantity > 0 ? Math.round(p.totalCostCents / p.quantity) : 0;

  async function save() {
    if (!p || p.quantity < 1) return;
    const rec = { ...p, id: p.id || uid(), createdAt: p.createdAt || new Date().toISOString() };
    const body = { date: rec.date, productId: rec.productId, quantity: rec.quantity, totalCostCents: rec.totalCostCents, note: rec.note, fromInvestment: rec.fromInvestment, paidBy: rec.paidBy ?? null };
    onClose();
    await s!.mutate(
      (d) => ({ ...d, purchases: isNew ? [rec, ...d.purchases] : d.purchases.map((x) => (x.id === rec.id ? rec : x)) }),
      () => (isNew ? api("/api/purchases", "POST", { id: rec.id, ...body }) : api(`/api/purchases/${rec.id}`, "PATCH", body)),
    );
  }
  async function remove() {
    if (!p || !(await confirm({ title: "Delete this restock?", body: "Stock and business money are recalculated.", confirmText: "Delete", danger: true }))) return;
    onClose();
    await s!.mutate((d) => ({ ...d, purchases: d.purchases.filter((x) => x.id !== p.id) }), () => api(`/api/purchases/${p.id}`, "DELETE"));
  }

  return (
    <Sheet
      open={!!value}
      onClose={onClose}
      title={isNew ? "Restock" : "Edit restock"}
      footer={
        <div className="flex gap-2">
          {!isNew && (
            <Button variant="ghost" className="text-neg" onClick={remove}>
              Delete
            </Button>
          )}
          <Button block onClick={onClose}>
            Cancel
          </Button>
          <Button block variant="primary" onClick={save} disabled={!p || p.quantity < 1 || (isNew && !p.fromInvestment && !p.paidBy)}>
            Save
          </Button>
        </div>
      }
    >
      {p && (
        <div className="space-y-4">
          <Field label="Product">
            <Select value={p.productId} onChange={(e) => setP({ ...p, productId: e.target.value })}>
              {s.data.products.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <NumberInput label="quantity" value={p.quantity} min={1} onChange={(n) => setP({ ...p, quantity: n ?? 0 })} />
            </Field>
            <Field label="Total cost">
              <MoneyInput label="total cost" value={p.totalCostCents} step={100} min={0} onChange={(c) => setP({ ...p, totalCostCents: c ?? 0 })} />
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-surface2/70 px-4 py-3">
            <span className="text-sm text-muted">Cost per unit</span>
            <span className="text-lg font-semibold tabular-nums">{fmtMoney(perUnit)}</span>
          </div>
          <Field label="Date">
            <Input type="date" value={toLocalDateInput(p.date)} onChange={(e) => e.target.value && setP({ ...p, date: fromLocalInput(e.target.value) })} />
          </Field>
          <Field label="Note (optional)">
            <Input value={p.note} onChange={(e) => setP({ ...p, note: e.target.value })} placeholder="Supplier, batch…" />
          </Field>
          {!p.fromInvestment && (
            <Field label="Paid by" hint="Who paid the supplier. A partner who paid out of pocket: it comes out of their cash held.">
              <MoneyToPicker value={p.paidBy ?? null} onChange={(v) => setP({ ...p, paidBy: v })} missing={isNew && !p.paidBy} missingText="Pick who paid." />
            </Field>
          )}
          <Toggle
            checked={p.fromInvestment}
            onChange={(v) => setP({ ...p, fromInvestment: v })}
            label="Paid from starting investment"
            hint="Adds stock and sets cost, but doesn’t subtract from business money (the starting balance already covers it)."
          />
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Adjustment sheet
export function AdjustSheet({ value, onClose }: { value: AdjustmentRec | null; onClose: () => void }) {
  const s = useLoaded();
  const confirm = useConfirm();
  const [a, setA] = useState<AdjustmentRec | null>(value);
  useEffect(() => setA(value), [value]);
  if (!s) return null;
  const isNew = !value?.id;
  const dir = a && a.quantity < 0 ? -1 : 1;
  // Current stock without this adjustment (when editing one, the ledger already counts its old amount).
  const stockNow = a ? (s.ledger.stock.get(a.productId)?.stock ?? 0) - (value?.id && value.productId === a.productId ? value.quantity : 0) : 0;

  async function save() {
    if (!a || a.quantity === 0) return;
    const rec = { ...a, id: a.id || uid(), createdAt: a.createdAt || new Date().toISOString() };
    const body = { date: rec.date, productId: rec.productId, quantity: rec.quantity, reason: rec.reason, note: rec.note };
    onClose();
    await s!.mutate(
      (d) => ({ ...d, adjustments: isNew ? [rec, ...d.adjustments] : d.adjustments.map((x) => (x.id === rec.id ? rec : x)) }),
      () => (isNew ? api("/api/adjustments", "POST", { id: rec.id, ...body }) : api(`/api/adjustments/${rec.id}`, "PATCH", body)),
    );
  }
  async function remove() {
    if (!a || !(await confirm({ title: "Delete this adjustment?", confirmText: "Delete", danger: true }))) return;
    onClose();
    await s!.mutate((d) => ({ ...d, adjustments: d.adjustments.filter((x) => x.id !== a.id) }), () => api(`/api/adjustments/${a.id}`, "DELETE"));
  }

  return (
    <Sheet
      open={!!value}
      onClose={onClose}
      title={isNew ? "Stock adjustment" : "Edit adjustment"}
      footer={
        <div className="flex gap-2">
          {!isNew && (
            <Button variant="ghost" className="text-neg" onClick={remove}>
              Delete
            </Button>
          )}
          <Button block onClick={onClose}>
            Cancel
          </Button>
          <Button block variant="primary" onClick={save} disabled={!a || a.quantity === 0}>
            Save
          </Button>
        </div>
      }
    >
      {a && (
        <div className="space-y-4">
          <Field label="Product">
            <Select value={a.productId} onChange={(e) => setA({ ...a, productId: e.target.value })}>
              {s.data.products.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Change">
              <Segmented
                className="h-12"
                value={dir === -1 ? "minus" : "plus"}
                onChange={(v) => setA({ ...a, quantity: Math.abs(a.quantity || 1) * (v === "minus" ? -1 : 1) })}
                options={[
                  { value: "plus", label: "Add" },
                  { value: "minus", label: "Remove" },
                ]}
              />
            </Field>
            <Field label="Quantity">
              <NumberInput label="quantity" value={Math.abs(a.quantity)} min={1} onChange={(n) => setA({ ...a, quantity: (n ?? 0) * dir })} />
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-surface2/70 px-4 py-3">
            <span className="text-sm text-muted">Stock after</span>
            <span className="text-lg font-semibold tabular-nums" data-stock-after>
              {stockNow} <span className="text-muted">→</span> {stockNow + a.quantity}
            </span>
          </div>
          <Field label="Reason">
            <Segmented<AdjustmentReason>
              value={a.reason}
              onChange={(r) => setA({ ...a, reason: r })}
              options={[
                { value: "breakage", label: "Breakage" },
                { value: "freebie", label: "Freebie" },
                { value: "correction", label: "Correction" },
              ]}
            />
          </Field>
          <Field label="Date">
            <Input type="date" value={toLocalDateInput(a.date)} onChange={(e) => e.target.value && setA({ ...a, date: fromLocalInput(e.target.value) })} />
          </Field>
          <Field label="Note (optional)">
            <Input value={a.note} onChange={(e) => setA({ ...a, note: e.target.value })} />
          </Field>
        </div>
      )}
    </Sheet>
  );
}
