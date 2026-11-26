"use client";

// Adjust stock: corrections only (recount, broken vial, freebie). Never touches money. Restocks are restock
// orders (Inventory > New restock order).
import { useEffect, useState } from "react";
import { api, useLoaded } from "@/components/store";
import { Button, Field, Input, NumberInput, Segmented, Select, Sheet, useConfirm } from "@/components/ui";
import { fromLocalInput, toLocalDateInput, uid } from "@/lib/format";
import { ADJUST_REASONS, type AdjustmentReason, type AdjustmentRec } from "@/lib/types";

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
    if (!a || a.quantity === 0 || !a.reason) return;
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
      title={isNew ? "Adjust stock" : "Edit adjustment"}
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
          <Button block variant="primary" onClick={save} disabled={!a || a.quantity === 0 || !a.reason} title={a && !a.reason ? "Pick a reason first" : undefined}>
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
            <Segmented<AdjustmentReason | "">
              value={a.reason ?? ""}
              onChange={(r) => r && setA({ ...a, reason: r })}
              className={!a.reason ? "ring-2 ring-neg/60" : undefined}
              options={ADJUST_REASONS}
            />
            {!a.reason && <p className="mt-1.5 text-sm font-medium text-neg">Pick a reason.</p>}
          </Field>
          <p className="text-xs text-muted">Corrections only: stock changes, money never does. To add stock you bought, use New restock order.</p>
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
