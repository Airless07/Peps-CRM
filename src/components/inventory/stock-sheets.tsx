"use client";

// Adjust stock: corrections only (recount, broken vial, freebie). Never touches money. Restocks are restock
// orders (Inventory > New restock order).
import { useEffect, useState } from "react";
import { api, useLoaded } from "@/components/store";
import { Button, Field, Input, NumberInput, Segmented, Select, Sheet, useConfirm } from "@/components/ui";
import { fromLocalInput, toLocalDateInput, uid } from "@/lib/format";
import Link from "next/link";
import { ADJUST_REASONS, LABS, expenseCategoryLabel, type AdjustmentReason, type AdjustmentRec } from "@/lib/types";
import { fmtMoney as money } from "@/lib/format";

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
    const lab = rec.reason === "lab_testing";
    const body = {
      date: rec.date, productId: rec.productId, quantity: rec.quantity, reason: rec.reason, note: rec.note,
      lab: lab ? (rec.lab ?? "").trim() : "", sampleId: lab ? (rec.sampleId ?? "").trim() : "", lot: lab ? (rec.lot ?? "").trim() : "", expenseId: lab ? rec.expenseId ?? null : null,
    };
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
                value={dir === -1 || a.reason === "lab_testing" ? "minus" : "plus"}
                onChange={(v) => setA({ ...a, quantity: Math.abs(a.quantity || 1) * (v === "minus" ? -1 : 1) })}
                options={
                  a.reason === "lab_testing"
                    ? [{ value: "minus", label: "Remove" }]
                    : [
                        { value: "plus", label: "Add" },
                        { value: "minus", label: "Remove" },
                      ]
                }
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
              // Lab testing always takes vials out.
              onChange={(r) => r && setA({ ...a, reason: r, quantity: r === "lab_testing" ? -Math.abs(a.quantity || 1) : a.quantity })}
              className={!a.reason ? "ring-2 ring-neg/60" : undefined}
              options={ADJUST_REASONS}
            />
            {!a.reason && <p className="mt-1.5 text-sm font-medium text-neg">Pick a reason.</p>}
          </Field>
          {a.reason === "lab_testing" && <LabFields a={a} setA={setA} />}
          <p className="text-xs text-muted">
            {a.reason === "lab_testing"
              ? "Vials sent to a lab come out of stock. Business money and cash held don't change (they were paid for at restock); their cost shows as Testing cost in Performance."
              : "Corrections only: stock changes, money never does. To add stock you bought, use New restock order."}
          </p>
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

/** Lab testing extras (all optional): lab, sample ID, lot, and the matching lab fee in Money > Expenses. */
function LabFields({ a, setA }: { a: AdjustmentRec; setA: (a: AdjustmentRec) => void }) {
  const s = useLoaded();
  if (!s) return null;
  const fees = (s.data.expenses ?? []).filter((x) => x.category === "lab_testing");
  const fee = fees.find((x) => x.id === a.expenseId);
  return (
    <div className="space-y-3 rounded-xl border border-line p-3" data-lab-fields>
      <Field label="Lab (optional)">
        <Input value={a.lab ?? ""} onChange={(e) => setA({ ...a, lab: e.target.value })} list="adjust-labs" placeholder="KMD Analytical, Janoshik…" />
        <datalist id="adjust-labs">
          {[...new Set([...LABS, ...fees.map((x) => x.vendor).filter(Boolean)])].map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sample ID (optional)">
          <Input value={a.sampleId ?? ""} onChange={(e) => setA({ ...a, sampleId: e.target.value })} placeholder="BL-05" className="font-mono" />
        </Field>
        <Field label="Lot (optional)">
          <Input value={a.lot ?? ""} onChange={(e) => setA({ ...a, lot: e.target.value })} placeholder="BL2611" className="font-mono" />
        </Field>
      </div>
      <Field label="Lab fee (optional)" hint={fees.length ? undefined : "No lab testing fee in Money → Expenses yet."}>
        <Select value={a.expenseId ?? ""} onChange={(e) => setA({ ...a, expenseId: e.target.value || null })} aria-label="Lab fee" disabled={!fees.length}>
          <option value="">Not linked</option>
          {fees.map((x) => (
            <option key={x.id} value={x.id}>
              {[x.vendor || expenseCategoryLabel(x.category), money(x.amountCents), x.date.slice(0, 10)].join(" · ")}
            </option>
          ))}
        </Select>
        {fee && (
          <Link href="/admin/money?tab=expenses" className="mt-1 inline-flex min-h-9 items-center text-sm font-medium text-accent">
            Open the fee in Money → Expenses
          </Link>
        )}
      </Field>
    </div>
  );
}
