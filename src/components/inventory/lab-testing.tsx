"use client";

// Lab testing: "Send samples to lab" (several sizes in one go) and the "Sent for testing" history.
// Vials sent never touch business money or cash held; their cost is reported as Testing cost.
import { useState } from "react";
import Link from "next/link";
import { Check, FlaskConical, Plus, Trash2 } from "lucide-react";
import { api, useLoaded } from "../store";
import { useToast } from "../toast";
import { Button, Card, Empty, Field, Input, NumberInput, Select, Sheet, cx } from "../ui";
import { productLabel } from "../restock/shared";
import { dayKey, fmtDay, fmtMoney, uid } from "@/lib/format";
import { testingSummary } from "@/lib/expenses";
import { LABS, expenseCategoryLabel } from "@/lib/types";

const fromDay = (k: string) => new Date(`${k}T12:00`).toISOString();
type Row = { key: string; productId: string; quantity: number; sampleId: string };

export function LabShipmentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useLoaded();
  const toast = useToast();
  const [date, setDate] = useState(dayKey(new Date()));
  const [lab, setLab] = useState("");
  const [lot, setLot] = useState("");
  const [expenseId, setExpenseId] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState(1);
  const [sample, setSample] = useState("");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!s) return null;
  const { data, ledger, mutate } = s;
  const products = data.products.filter((p) => !p.archived);
  const label = (id: string) => {
    const p = data.products.find((x) => x.id === id);
    return p ? productLabel(p) : "Deleted product";
  };
  const fees = (data.expenses ?? []).filter((x) => x.category === "lab_testing");
  const unit = (id: string) => ledger.stock.get(id)?.unitCost ?? 0;
  const vials = rows.reduce((a, r) => a + r.quantity, 0);
  const cost = rows.reduce((a, r) => a + r.quantity * unit(r.productId), 0);
  const per = new Map<string, number>();
  for (const r of rows) per.set(r.productId, (per.get(r.productId) ?? 0) + r.quantity);

  const reset = () => {
    setRows([]);
    setReview(false);
    setLab("");
    setLot("");
    setExpenseId("");
    setNote("");
    setSample("");
    setPick("");
    setQty(1);
  };
  function addRow() {
    if (!pick || qty < 1) return;
    setRows((r) => [...r, { key: uid(), productId: pick, quantity: qty, sampleId: sample.trim() }]);
    setPick("");
    setQty(1);
    setSample("");
  }
  async function confirm() {
    setBusy(true);
    const id = uid();
    const ok = await mutate(null, () =>
      api("/api/lab-shipments", "POST", { id, date: fromDay(date), lab: lab.trim(), lot: lot.trim(), expenseId: expenseId || null, note: note.trim(), rows: rows.map((r) => ({ productId: r.productId, quantity: r.quantity, sampleId: r.sampleId })) }),
    );
    setBusy(false);
    if (ok) {
      toast.show({ message: `${vials} vials sent for testing${lab.trim() ? ` to ${lab.trim()}` : ""}`, tone: "success" });
      reset();
      onClose();
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={review ? "Is this right?" : "Send samples to lab"}
      footer={
        review ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="primary" size="lg" block disabled={busy} onClick={confirm} data-confirm-shipment>
              <Check size={18} /> {busy ? "Saving…" : "Yes, take them out of stock"}
            </Button>
            <Button size="lg" block onClick={() => setReview(false)} disabled={busy}>
              No, go back and edit
            </Button>
          </div>
        ) : (
          <Button variant="primary" size="lg" block disabled={rows.length === 0} onClick={() => setReview(true)} data-review-shipment>
            Review {rows.length ? `(${rows.length} ${rows.length === 1 ? "size" : "sizes"}, ${vials} vials)` : ""}
          </Button>
        )
      }
    >
      {review ? (
        <div className="space-y-3" data-shipment-review>
          <div className="text-sm text-muted">
            {fmtDay(date)}
            {lab ? ` · ${lab}` : ""}
            {lot ? ` · lot ${lot}` : ""}
          </div>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {rows.map((r) => {
              const now = ledger.stock.get(r.productId)?.stock ?? 0;
              const after = now - (per.get(r.productId) ?? 0);
              return (
                <li key={r.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">{label(r.productId)}</div>
                    <div className="text-xs text-muted">
                      {r.quantity} {r.quantity === 1 ? "vial" : "vials"}
                      {r.sampleId ? ` · sample ${r.sampleId}` : ""} · {fmtMoney(r.quantity * unit(r.productId))}
                    </div>
                  </div>
                  <span className="shrink-0 tabular-nums">
                    stock {now} → <span className={cx("font-semibold", after < 0 && "text-neg")}>{after}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="rounded-xl bg-surface2/70 px-4 py-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Vials sent</span>
              <span className="font-semibold tabular-nums">{vials}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Testing cost (their cost per vial)</span>
              <span className="font-semibold tabular-nums">{fmtMoney(cost)}</span>
            </div>
          </div>
          <p className="text-xs text-muted">Business money and cash held don&apos;t change: these vials were paid for at restock. Their cost shows as Testing cost in Performance.</p>
        </div>
      ) : (
        <div className="space-y-4" data-lab-shipment>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lab">
              <Input value={lab} onChange={(e) => setLab(e.target.value)} list="shipment-labs" placeholder="KMD Analytical" />
              <datalist id="shipment-labs">
                {[...new Set([...LABS, ...fees.map((x) => x.vendor).filter(Boolean)])].map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </Field>
            <Field label="Lot">
              <Input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="BL2611" className="font-mono" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </Field>
            <Field label="Lab fee (optional)">
              <Select value={expenseId} onChange={(e) => setExpenseId(e.target.value)} aria-label="Lab fee" disabled={!fees.length}>
                <option value="">{fees.length ? "Not linked" : "None yet"}</option>
                {fees.map((x) => (
                  <option key={x.id} value={x.id}>
                    {[x.vendor || expenseCategoryLabel(x.category), fmtMoney(x.amountCents), x.date.slice(0, 10)].join(" · ")}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Card className="p-3">
            <div className="mb-2 text-sm font-semibold">Add a product</div>
            <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Product to send">
              <option value="">Pick a product and size…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {productLabel(p)} (stock {ledger.stock.get(p.id)?.stock ?? 0})
                </option>
              ))}
            </Select>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Vials">
                <NumberInput label="vials" value={qty} min={1} onChange={(n) => setQty(n ?? 0)} />
              </Field>
              <Field label="Sample ID">
                <Input value={sample} onChange={(e) => setSample(e.target.value)} placeholder="BL-05" className="font-mono" />
              </Field>
            </div>
            <Button className="mt-3" block onClick={addRow} disabled={!pick || qty < 1} data-add-sample>
              <Plus size={16} /> Add row
            </Button>
          </Card>

          {rows.length > 0 && (
            <ul className="divide-y divide-line rounded-2xl border border-line" data-shipment-rows>
              {rows.map((r) => (
                <li key={r.key} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{label(r.productId)}</span>
                    <span className="text-muted">
                      {" "}
                      · {r.quantity} {r.quantity === 1 ? "vial" : "vials"}
                      {r.sampleId ? ` · ${r.sampleId}` : ""}
                    </span>
                  </span>
                  <button type="button" aria-label={`Remove ${label(r.productId)}`} onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))} className="flex h-10 w-10 items-center justify-center rounded-xl text-muted hover:bg-surface2 hover:text-neg">
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Field label="Note (optional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      )}
    </Sheet>
  );
}

/** "Sent for testing": date, product/size, vials, lab, sample ID, lot, and totals for the period. */
export function SentForTesting({ inRange, periodLabel }: { inRange?: (iso: string) => boolean; periodLabel?: string }) {
  const s = useLoaded();
  if (!s) return null;
  const { data } = s;
  const sum = testingSummary(data.adjustments, inRange);
  const label = (id: string) => {
    const p = data.products.find((x) => x.id === id);
    return p ? productLabel(p) : "Deleted product";
  };
  const fee = (id?: string | null) => (id ? (data.expenses ?? []).find((x) => x.id === id) : undefined);
  return (
    <div data-sent-for-testing>
      <div className="mb-2 grid grid-cols-2 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted">Vials sent{periodLabel ? ` · ${periodLabel}` : ""}</div>
          <div className="text-lg font-semibold tabular-nums" data-testing-vials>
            {sum.vials}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted">Testing cost{periodLabel ? ` · ${periodLabel}` : ""}</div>
          <div className="text-lg font-semibold tabular-nums" data-testing-cost>
            {fmtMoney(sum.costCents)}
          </div>
        </Card>
      </div>
      {sum.rows.length === 0 ? (
        <Empty icon={<FlaskConical size={26} />} title="Nothing sent for testing yet" body="Use “Send samples to lab”, or Adjust stock with the Lab testing reason." />
      ) : (
        <Card className="divide-y divide-line">
          {sum.rows.map((a) => {
            const f = fee(a.expenseId);
            return (
              <div key={a.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{label(a.productId)}</div>
                  <div className="text-xs text-muted">
                    {fmtDay(dayKey(a.date))}
                    {a.lab ? ` · ${a.lab}` : ""}
                    {a.sampleId ? ` · sample ${a.sampleId}` : ""}
                    {a.lot ? ` · lot ${a.lot}` : ""}
                  </div>
                  {f && (
                    <Link href="/admin/money?tab=expenses" className="text-xs font-medium text-accent">
                      Lab fee: {f.vendor || "Lab testing"} {fmtMoney(f.amountCents)}
                    </Link>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold tabular-nums">
                    {-a.quantity} {-a.quantity === 1 ? "vial" : "vials"}
                  </div>
                  <div className="text-xs text-muted tabular-nums">{fmtMoney(a.costCents ?? 0)}</div>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
