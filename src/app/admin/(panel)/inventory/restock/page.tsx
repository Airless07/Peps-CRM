"use client";

// New restock order (and edit a saved one): 1. add products like a cart, 2. order details, 3. review.
// Nothing changes until "Yes, save restock". A new order is kept as a draft in this browser while you work.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Paperclip, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { MoneyToPicker } from "@/components/money-to";
import { productLabel, restockLines, useDeleteRestock } from "@/components/restock/shared";
import { api, useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Button, Card, Field, Input, MoneyInput, NumberInput, PageHeader, PageSkeleton, Segmented, Textarea, Toggle, cx } from "@/components/ui";
import { cashPosition } from "@/lib/cash";
import { dayKey, fmtMoney, uid } from "@/lib/format";
import { computeLedger } from "@/lib/money";
import { addLine, defaultRestockName, lineFrom, planRestock, pricesOf, vialsFrom, type FeeMode, type PriceMode, type QtyMode } from "@/lib/restock";
import type { AppData, CashHolder, PurchaseRec } from "@/lib/types";

interface DraftLine {
  key: string;
  productId: string;
  quantity: number;
  lineCents: number;
  free: boolean;
  perBox: number;
}
interface Draft {
  name: string;
  /** The name was typed by hand (else it follows the date). */
  named: boolean;
  date: string;
  supplier: string;
  lot: string;
  notes: string;
  file: string;
  fileName: string;
  mime: string;
  paidBy: CashHolder | null;
  shippingCents: number;
  shippingDiscountCents: number;
  discountCents: number;
  feeMode: FeeMode;
  feeValue: number;
  lines: DraftLine[];
}

const DRAFT_KEY = "restock-order-draft-v1";
const emptyDraft = (): Draft => {
  const date = dayKey(new Date());
  return { name: defaultRestockName(date), named: false, date, supplier: "", lot: "", notes: "", file: "", fileName: "", mime: "", paidBy: null, shippingCents: 0, shippingDiscountCents: 0, discountCents: 0, feeMode: "amount", feeValue: 0, lines: [] };
};
const readDraft = (): Draft | null => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? { ...emptyDraft(), ...(JSON.parse(raw) as Draft) } : null;
  } catch {
    return null;
  }
};
const writeDraft = (d: Draft | null) => {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {}
};
/** A day picked as a date is saved at local noon so it never slips a day in another time zone. */
const fromDay = (k: string) => new Date(`${k}T12:00`).toISOString();

type Step = 1 | 2 | 3;

export default function RestockOrderPage() {
  const s = useLoaded();
  const router = useRouter();
  const toast = useToast();
  const remove = useDeleteRestock();
  const [editId, setEditId] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [original, setOriginal] = useState<Draft | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  // Load: an order to edit (?edit=id) or the saved draft.
  useEffect(() => {
    if (!s || draft) return;
    const q = new URLSearchParams(window.location.search);
    setFrom(q.get("from"));
    const id = q.get("edit");
    if (id) {
      const r = (s.data.restockOrders ?? []).find((x) => x.id === id);
      if (!r) {
        toast.show({ message: "That restock no longer exists.", tone: "error" });
        router.replace("/admin/inventory");
        return;
      }
      const d: Draft = {
        name: r.name, named: true, date: dayKey(r.date), supplier: r.supplier, lot: r.lot, notes: r.notes, file: r.file, fileName: r.fileName, mime: r.mime, paidBy: r.paidBy,
        shippingCents: r.shippingCents, shippingDiscountCents: r.shippingDiscountCents, discountCents: r.discountCents, feeMode: r.feeMode, feeValue: r.feeValue,
        lines: restockLines(s.data, id).map((l) => ({ key: l.id, productId: l.productId, quantity: l.quantity, lineCents: l.listCents ?? l.totalCostCents, free: l.listCents === 0, perBox: 10 })),
      };
      setEditId(id);
      setDraft(d);
      setOriginal(d);
    } else setDraft(readDraft() ?? emptyDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, draft]);

  // A new order saves itself as a draft while you work.
  useEffect(() => {
    if (draft && !editId) writeDraft(draft);
  }, [draft, editId]);

  const update = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const go = (n: Step) => {
    setStep(n);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const plan = useMemo(() => (draft ? planRestock(draft.lines, draft) : null), [draft]);

  if (!s || !draft || !plan) return <PageSkeleton />;
  const back = () => router.push(from === "expenses" ? "/admin/money?tab=expenses" : "/admin/inventory");

  async function save() {
    if (!draft || !plan || plan.error || !draft.paidBy) return;
    setBusy(true);
    const body = {
      name: draft.name.trim() || defaultRestockName(draft.date), date: fromDay(draft.date), supplier: draft.supplier.trim(), lot: draft.lot.trim(), notes: draft.notes.trim(),
      paidBy: draft.paidBy, shippingCents: draft.shippingCents, shippingDiscountCents: draft.shippingDiscountCents, discountCents: draft.discountCents, feeMode: draft.feeMode, feeValue: draft.feeValue,
      file: draft.file, fileName: draft.fileName, mime: draft.mime,
      lines: draft.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, lineCents: l.free ? 0 : l.lineCents, free: l.free })),
    };
    try {
      if (editId) await api(`/api/restocks/${editId}`, "PATCH", body);
      else await api("/api/restocks", "POST", { id: uid(), ...body });
      if (!editId) writeDraft(null);
      await s!.refresh();
      toast.show({ message: `${editId ? "Restock updated" : "Restock saved"} · ${fmtMoney(plan.totalCents)} paid by ${s!.name(draft.paidBy)}`, tone: "success" });
      back();
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    writeDraft(null);
    setDraft(emptyDraft());
    go(1);
  }

  return (
    <div ref={top} className="scroll-mt-24" data-restock-page>
      <PageHeader
        title={editId ? "Edit restock order" : "New restock order"}
        sub={editId ? draft.name : "Add products like a cart, then the order details, then check it before saving."}
        actions={
          <Button onClick={back}>
            <ArrowLeft size={17} /> Back
          </Button>
        }
      />
      <Steps step={step} onStep={(n) => (n < step || (n === 2 && draft.lines.length > 0) || (n === 3 && !plan.error && !!draft.paidBy) ? go(n) : undefined)} />

      {step === 1 && <ItemsStep draft={draft} setLines={(lines) => update({ lines })} onNext={() => go(2)} onDiscard={editId ? undefined : discard} />}
      {step === 2 && <DetailsStep draft={draft} update={update} plan={plan} onBack={() => go(1)} onNext={() => go(3)} />}
      {step === 3 && (
        <ReviewStep
          data={s.data}
          draft={draft}
          original={original}
          editId={editId}
          plan={plan}
          busy={busy}
          onYes={save}
          onNo={() => go(1)}
          onDelete={
            editId
              ? async () => {
                  const r = (s.data.restockOrders ?? []).find((x) => x.id === editId);
                  if (r && (await remove(r))) back();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function Steps({ step, onStep }: { step: Step; onStep: (n: Step) => void }) {
  const items: [Step, string][] = [
    [1, "Products"],
    [2, "Order details"],
    [3, "Review"],
  ];
  return (
    <ol className="mb-5 grid grid-cols-3 gap-2" data-restock-steps>
      {items.map(([n, label]) => (
        <li key={n}>
          <button
            type="button"
            onClick={() => onStep(n)}
            className={cx("flex h-12 w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium", step === n ? "border-accent bg-accent/10 text-ink" : step > n ? "border-line text-ink" : "border-line text-muted")}
            aria-current={step === n ? "step" : undefined}
          >
            <span className={cx("flex h-6 w-6 items-center justify-center rounded-full text-xs", step > n ? "bg-pos text-white" : step === n ? "bg-accent text-white" : "bg-surface2")}>{step > n ? <Check size={14} /> : n}</span>
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{n === 2 ? "Details" : label}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- Step 1: products
function ItemsStep({ draft, setLines, onNext, onDiscard }: { draft: Draft; setLines: (l: DraftLine[]) => void; onNext: () => void; onDiscard?: () => void }) {
  const s = useLoaded();
  const [productId, setProductId] = useState("");
  const [search, setSearch] = useState("");
  const [qtyMode, setQtyMode] = useState<QtyMode>("vials");
  const [vials, setVials] = useState(10);
  const [boxes, setBoxes] = useState(1);
  const [perBox, setPerBox] = useState(10);
  const [priceMode, setPriceMode] = useState<PriceMode>("vial");
  const [price, setPrice] = useState(0);
  const [free, setFree] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  if (!s) return null;
  const { data, ledger } = s;
  const products = data.products.filter((p) => !p.archived);
  const label = (id: string) => {
    const p = data.products.find((x) => x.id === id);
    return p ? productLabel(p) : "Deleted product";
  };
  const q = search.trim().toLowerCase();
  const matches = products.filter((p) => !q || productLabel(p).toLowerCase().includes(q));
  const qty = vialsFrom(qtyMode, vials, boxes, perBox);
  const lineCents = free ? 0 : lineFrom(priceMode, price, qty, perBox);
  const prices = pricesOf(lineCents, qty, perBox);
  const canAdd = !!productId && qty > 0 && (free || lineCents > 0);

  const reset = () => {
    setProductId("");
    setSearch("");
    setQtyMode("vials");
    setVials(10);
    setBoxes(1);
    setPerBox(10);
    setPriceMode("vial");
    setPrice(0);
    setFree(false);
    setEditing(null);
  };
  function add() {
    if (!canAdd) return;
    const line: DraftLine = { key: editing ?? uid(), productId, quantity: qty, lineCents, free, perBox };
    if (editing) {
      const rest = draft.lines.filter((l) => l.key !== editing);
      const i = draft.lines.findIndex((l) => l.key === editing);
      // Put it back in its place, merging if it now matches another line.
      const merged = rest.some((l) => l.productId === line.productId && l.free === line.free) ? addLine(rest, line) : [...rest.slice(0, i), line, ...rest.slice(i)];
      setLines(merged);
    } else setLines(addLine(draft.lines, line));
    reset();
  }
  function edit(l: DraftLine) {
    setEditing(l.key);
    setProductId(l.productId);
    setSearch("");
    setQtyMode("vials");
    setVials(l.quantity);
    setPerBox(l.perBox || 10);
    setFree(l.free);
    setPriceMode("line");
    setPrice(l.lineCents);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="p-4" data-line-form>
        <div className="mb-3 text-sm font-semibold">{editing ? "Edit line" : "Add a product"}</div>
        <Field label="Product and size">
          {productId ? (
            <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-medium" data-picked-product>
                {label(productId)}
              </span>
              <span className="shrink-0 text-xs text-muted">stock {ledger.stock.get(productId)?.stock ?? 0}</span>
              <button type="button" className="h-9 rounded-lg px-2 text-sm font-medium text-accent" onClick={() => setProductId("")}>
                Change
              </button>
            </div>
          ) : (
            <div>
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" className="pl-9" aria-label="Search products" data-product-search />
              </div>
              <ul className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-line" role="listbox" aria-label="Products">
                {matches.map((p) => (
                  <li key={p.id}>
                    <button type="button" role="option" aria-selected={false} onClick={() => setProductId(p.id)} className="flex min-h-11 w-full items-center justify-between gap-2 border-b border-line px-3 text-left text-sm last:border-b-0 hover:bg-surface2">
                      <span className="truncate">{productLabel(p)}</span>
                      <span className="shrink-0 text-xs text-muted">stock {ledger.stock.get(p.id)?.stock ?? 0}</span>
                    </button>
                  </li>
                ))}
                {matches.length === 0 && <li className="px-3 py-3 text-sm text-muted">No product matches “{search}”.</li>}
              </ul>
            </div>
          )}
        </Field>

        <div className="mt-4 space-y-4">
          <Field label="Quantity">
            <Segmented
              size="sm"
              value={qtyMode}
              onChange={(m) => {
                if (m === "boxes") setBoxes(Math.max(1, Math.round(vials / (perBox || 10))));
                else setVials(qty);
                setQtyMode(m);
              }}
              options={[
                { value: "vials", label: "Vials" },
                { value: "boxes", label: "Boxes" },
              ]}
            />
            {qtyMode === "vials" ? (
              <div className="mt-2">
                <NumberInput label="vials" value={vials} min={1} onChange={(n) => setVials(n ?? 0)} />
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="Boxes">
                  <NumberInput label="boxes" value={boxes} min={1} onChange={(n) => setBoxes(n ?? 0)} />
                </Field>
                <Field label="Vials per box">
                  <NumberInput label="vials per box" value={perBox} min={1} onChange={(n) => setPerBox(n ?? 0)} />
                </Field>
              </div>
            )}
          </Field>

          <Toggle checked={free} onChange={setFree} label="Free" hint="A free item from the supplier: $0, and it gets none of the shipping or fees." />

          {!free && (
            <Field label="Price">
              <Segmented
                size="sm"
                value={priceMode}
                onChange={(m) => {
                  // Keep the same line total when switching how the price is entered.
                  setPrice(m === "line" ? prices.line : m === "box" ? prices.box : prices.vial);
                  setPriceMode(m);
                }}
                options={[
                  { value: "vial", label: "Per vial" },
                  { value: "box", label: "Per box" },
                  { value: "line", label: "Line total" },
                ]}
              />
              <div className="mt-2">
                <MoneyInput label={priceMode === "line" ? "line total" : priceMode === "box" ? "price per box" : "price per vial"} value={price} min={0} onChange={(c) => setPrice(c ?? 0)} />
              </div>
            </Field>
          )}

          <div className="rounded-xl bg-surface2/70 px-4 py-3 text-sm" data-line-preview>
            <div className="flex justify-between">
              <span className="text-muted">Vials</span>
              <span className="font-semibold tabular-nums">{qty}</span>
            </div>
            {!free && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted">Per vial · per box ({perBox})</span>
                  <span className="tabular-nums">
                    {fmtMoney(prices.vial)} · {fmtMoney(prices.box)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Line total</span>
                  <span className="font-semibold tabular-nums">{fmtMoney(lineCents)}</span>
                </div>
              </>
            )}
            {free && <div className="mt-1 text-pos">Free · $0</div>}
          </div>

          <div className="flex gap-2">
            {editing && (
              <Button size="lg" onClick={reset}>
                Cancel
              </Button>
            )}
            <Button variant="primary" size="lg" block disabled={!canAdd} onClick={add} data-add-line>
              {editing ? <Check size={18} /> : <Plus size={18} />} {editing ? "Update line" : "Add to order"}
            </Button>
          </div>
        </div>
      </Card>

      <div>
        <Card data-order-lines>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-sm font-semibold">
              In this order ({draft.lines.length} {draft.lines.length === 1 ? "line" : "lines"})
            </span>
            <span className="text-sm font-semibold tabular-nums">{fmtMoney(draft.lines.reduce((a, l) => a + (l.free ? 0 : l.lineCents), 0))}</span>
          </div>
          {draft.lines.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">No products yet. Pick one and tap “Add to order”.</p>
          ) : (
            <ul className="divide-y divide-line">
              {draft.lines.map((l) => (
                <li key={l.key} className={cx("flex items-center gap-2 px-4 py-2.5 text-sm", editing === l.key && "bg-accent/5")} data-order-line>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{label(l.productId)}</div>
                    <div className="text-xs text-muted">
                      {l.quantity} {l.quantity === 1 ? "vial" : "vials"} · {l.free ? <span className="text-pos">free</span> : `${fmtMoney(Math.round(l.lineCents / l.quantity))}/vial`}
                    </div>
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums">{fmtMoney(l.free ? 0 : l.lineCents)}</span>
                  <button type="button" aria-label={`Edit ${label(l.productId)}`} onClick={() => edit(l)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface2 hover:text-ink">
                    <Pencil size={15} />
                  </button>
                  <button type="button" aria-label={`Remove ${label(l.productId)}`} onClick={() => setLines(draft.lines.filter((x) => x.key !== l.key))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface2 hover:text-neg">
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <p className="mt-2 text-xs text-muted">The same product and size added twice becomes one line. {onDiscard ? "This order is saved as a draft on this device until you save or discard it." : ""}</p>
        <div className="mt-4 flex gap-2">
          {onDiscard && draft.lines.length > 0 && (
            <Button size="lg" onClick={onDiscard}>
              Discard draft
            </Button>
          )}
          <Button variant="primary" size="lg" block disabled={draft.lines.length === 0} onClick={onNext} data-next>
            Next: order details
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Step 2: details
function DetailsStep({ draft, update, plan, onBack, onNext }: { draft: Draft; update: (p: Partial<Draft>) => void; plan: ReturnType<typeof planRestock>; onBack: () => void; onNext: () => void }) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [tried, setTried] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const missing = !draft.paidBy;

  async function upload(f: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/expenses/file", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { error?: string; file?: string; mime?: string; fileName?: string };
      if (!res.ok || !json.file) throw new Error(json.error || "Upload failed. Try again.");
      update({ file: json.file, fileName: json.fileName || f.name, mime: json.mime ?? "" });
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: "error" });
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-details-step>
      <Card className="space-y-4 p-4">
        <Field label="Order name">
          <Input value={draft.name} onChange={(e) => update({ name: e.target.value, named: true })} data-order-name />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={draft.date} onChange={(e) => e.target.value && update({ date: e.target.value, ...(draft.named ? {} : { name: defaultRestockName(e.target.value) }) })} />
          </Field>
          <Field label="Lot number (optional)">
            <Input value={draft.lot} onChange={(e) => update({ lot: e.target.value })} placeholder="BL2611" className="font-mono" />
          </Field>
        </div>
        <Field label="Supplier (optional)">
          <Input value={draft.supplier} onChange={(e) => update({ supplier: e.target.value })} />
        </Field>
        <Field label="Paid by">
          <MoneyToPicker value={draft.paidBy} onChange={(v) => update({ paidBy: v })} missing={missing && tried} missingText="Pick who paid." />
        </Field>
        <Field label="Notes (optional)">
          <Textarea value={draft.notes} onChange={(e) => update({ notes: e.target.value })} rows={3} />
        </Field>
        <Field label="Invoice (optional)" hint="PDF or screenshot. Only admins can open it.">
          {draft.file ? (
            <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
              <Paperclip size={15} className="shrink-0 text-muted" />
              <a href={`/api/expenses/file/${encodeURIComponent(draft.file)}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-accent">
                {draft.fileName || "Invoice"}
              </a>
              <button type="button" aria-label="Remove invoice" onClick={() => update({ file: "", fileName: "", mime: "" })} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface2 hover:text-neg">
                <X size={15} />
              </button>
            </div>
          ) : (
            <>
              <input ref={input} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <Button variant="soft" onClick={() => input.current?.click()} disabled={uploading}>
                <Paperclip size={16} /> {uploading ? "Uploading…" : "Attach invoice"}
              </Button>
            </>
          )}
        </Field>
      </Card>

      <div>
        <Card className="space-y-4 p-4">
          <div className="text-sm font-semibold">Extra costs and discounts</div>
          <p className="-mt-2 text-xs text-muted">Spread over the paid items by their share of cost, so each vial’s cost includes them. Free items stay $0.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Shipping">
              <MoneyInput label="shipping" value={draft.shippingCents} min={0} onChange={(c) => update({ shippingCents: c ?? 0 })} />
            </Field>
            <Field label="Shipping discount">
              <MoneyInput label="shipping discount" value={draft.shippingDiscountCents} min={0} onChange={(c) => update({ shippingDiscountCents: c ?? 0 })} />
            </Field>
          </div>
          <Field label="Other discounts">
            <MoneyInput label="other discounts" value={draft.discountCents} min={0} onChange={(c) => update({ discountCents: c ?? 0 })} />
          </Field>
          <Field label="Payment fee">
            <Segmented
              size="sm"
              value={draft.feeMode}
              onChange={(m) => update({ feeMode: m, feeValue: 0 })}
              options={[
                { value: "amount", label: "Amount" },
                { value: "percent", label: "Percent" },
              ]}
            />
            <div className="mt-2">
              {draft.feeMode === "amount" ? (
                <MoneyInput label="payment fee" value={draft.feeValue} min={0} onChange={(c) => update({ feeValue: c ?? 0 })} />
              ) : (
                <div className="relative">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.1}
                    value={draft.feeValue ? String(draft.feeValue / 100) : ""}
                    placeholder="5"
                    onChange={(e) => update({ feeValue: Math.max(0, Math.round((Number(e.target.value) || 0) * 100)) })}
                    aria-label="Payment fee percent"
                    className="pr-10"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">%</span>
                </div>
              )}
            </div>
            {draft.feeMode === "percent" && draft.feeValue > 0 && <p className="mt-1 text-xs text-muted">= {fmtMoney(plan.feeCents)} of {fmtMoney(plan.productsCents + plan.shippingCents - plan.discountsCents)}</p>}
          </Field>
        </Card>
        <Card className="mt-3 p-4 text-sm">
          <Totals plan={plan} />
        </Card>
        {plan.error && <p className="mt-2 text-sm font-medium text-neg">{plan.error}</p>}
        <div className="mt-4 flex gap-2">
          <Button size="lg" onClick={onBack}>
            Back
          </Button>
          <Button
            variant="primary"
            size="lg"
            block
            disabled={!!plan.error}
            onClick={() => {
              setTried(true);
              if (!draft.paidBy) return toast.show({ message: "Pick who paid (Ahmad, Mo or Bank).", tone: "error" });
              onNext();
            }}
            data-next
          >
            Next: review
          </Button>
        </div>
      </div>
    </div>
  );
}

function Totals({ plan, paidBy }: { plan: ReturnType<typeof planRestock>; paidBy?: string }) {
  const row = (label: string, v: string, strong = false) => (
    <div className={cx("flex justify-between py-0.5", strong && "mt-1 border-t border-line pt-2 text-base font-semibold")}>
      <span className={strong ? "" : "text-muted"}>{label}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
  return (
    <div data-totals>
      {row("Products", fmtMoney(plan.productsCents))}
      {row("Shipping", fmtMoney(plan.shippingCents))}
      {row("Discounts", plan.discountsCents ? `-${fmtMoney(plan.discountsCents)}` : fmtMoney(0))}
      {row("Fees", fmtMoney(plan.feeCents))}
      {row("Total paid", fmtMoney(plan.totalCents), true)}
      {paidBy && row("Paid by", paidBy)}
    </div>
  );
}

// ---------------------------------------------------------------- Step 3: review
function ReviewStep({
  data,
  draft,
  original,
  editId,
  plan,
  busy,
  onYes,
  onNo,
  onDelete,
}: {
  data: AppData;
  draft: Draft;
  original: Draft | null;
  editId: string | null;
  plan: ReturnType<typeof planRestock>;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
  onDelete?: () => void;
}) {
  const s = useLoaded();
  // Money and stock exactly as they would be after saving: the same math as the app, on a copy.
  const after = useMemo(() => {
    const now = new Date().toISOString();
    const date = fromDay(draft.date);
    const rows: PurchaseRec[] = plan.lines.map((l, i) => ({ id: `preview-${i}`, date, productId: l.productId, quantity: l.quantity, totalCostCents: l.costCents, listCents: l.lineCents, note: "", fromInvestment: false, paidBy: draft.paidBy, restockOrderId: editId ?? "new", createdAt: now }));
    const next: AppData = { ...data, purchases: [...data.purchases.filter((p) => !editId || p.restockOrderId !== editId), ...rows] };
    const ledger = computeLedger(next);
    return { ledger, cash: cashPosition(next, ledger) };
  }, [data, draft, plan, editId]);
  if (!s) return null;
  const { ledger, name } = s;
  const cashNow = cashPosition(data, ledger);
  const label = (id: string) => {
    const p = data.products.find((x) => x.id === id);
    return p ? productLabel(p) : "Deleted product";
  };
  const oldPlan = original ? planRestock(original.lines, original) : null;
  const oldBy = new Map<string, { qty: number; cost: number }>();
  for (const l of oldPlan?.lines ?? []) {
    const k = `${l.productId}:${l.free}`;
    const o = oldBy.get(k) ?? { qty: 0, cost: 0 };
    oldBy.set(k, { qty: o.qty + l.quantity, cost: o.cost + l.costCents });
  }
  const removed = (oldPlan?.lines ?? []).filter((o) => !plan.lines.some((l) => l.productId === o.productId && l.free === o.free));
  const negatives = [...new Set(plan.lines.map((l) => l.productId).concat(removed.map((r) => r.productId)))].filter((pid) => (after.ledger.stock.get(pid)?.stock ?? 0) < 0);
  const payer = draft.paidBy!;
  const holders: CashHolder[] = [...new Set<CashHolder>([payer, ...(original?.paidBy && original.paidBy !== payer ? [original.paidBy] : [])])];

  return (
    <div data-review-step>
      <h2 className="text-xl font-semibold tracking-tight">Is this what you were looking for?</h2>
      <p className="mt-1 text-sm text-muted">{editId ? "The changes from the saved order are shown. " : ""}Nothing changes until you tap “Yes, save restock”.</p>

      <Card className="mt-4">
        <div className="border-b border-line px-4 py-3">
          <div className="font-semibold">{draft.name || defaultRestockName(draft.date)}</div>
          <div className="text-xs text-muted">
            {new Date(`${draft.date}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            {draft.supplier ? ` · ${draft.supplier}` : ""}
            {draft.lot ? ` · lot ${draft.lot}` : ""}
            {draft.fileName ? ` · ${draft.fileName}` : ""}
          </div>
        </div>
        <div className="hidden grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] gap-2 border-b border-line px-4 py-2 text-xs font-medium uppercase tracking-wider text-muted sm:grid">
          <span>Product</span>
          <span className="text-right">Vials</span>
          <span className="text-right">Per vial</span>
          <span className="text-right">Line total</span>
          <span className="text-right">Stock</span>
        </div>
        <ul className="divide-y divide-line" data-review-lines>
          {plan.lines.map((l, i) => {
            const now = ledger.stock.get(l.productId)?.stock ?? 0;
            const then = after.ledger.stock.get(l.productId)?.stock ?? 0;
            const old = oldBy.get(`${l.productId}:${l.free}`);
            const changed = !!original && (!old || old.qty !== l.quantity || old.cost !== l.costCents);
            return (
              <li key={i} className={cx("grid grid-cols-2 gap-x-2 gap-y-1 px-4 py-3 text-sm sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] sm:items-center", changed && "bg-warn/10")} data-review-line>
                <span className="col-span-2 font-medium sm:col-span-1">
                  {label(l.productId)}
                  {l.free && <span className="ml-1.5 text-xs font-normal text-pos">free</span>}
                  {changed && <span className="ml-1.5 text-xs font-normal text-warn">{old ? `was ${old.qty} vials, ${fmtMoney(old.cost)}` : "new line"}</span>}
                </span>
                <span className="text-muted sm:text-right sm:text-ink">
                  <span className="sm:hidden">Vials </span>
                  <span className="tabular-nums">{l.quantity}</span>
                </span>
                <span className="text-right tabular-nums">
                  {l.free ? (
                    "$0.00"
                  ) : (
                    <>
                      <span className="text-muted">{fmtMoney(l.unitBeforeCents)} →</span> {fmtMoney(l.unitAfterCents)}
                    </>
                  )}
                </span>
                <span className="text-muted sm:text-right sm:text-ink">
                  <span className="sm:hidden">Line total </span>
                  <span className="font-semibold tabular-nums">{fmtMoney(l.costCents)}</span>
                </span>
                <span className="text-right tabular-nums">
                  <span className="sm:hidden text-muted">Stock </span>
                  {now} → <span className={cx("font-semibold", then < 0 && "text-neg")}>{then}</span>
                </span>
              </li>
            );
          })}
          {removed.map((r, i) => (
            <li key={`removed-${i}`} className="px-4 py-3 text-sm text-neg">
              Removed: {label(r.productId)}, {r.quantity} vials, {fmtMoney(r.costCents)} (stock {ledger.stock.get(r.productId)?.stock ?? 0} → {after.ledger.stock.get(r.productId)?.stock ?? 0})
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-4 py-2 text-xs text-muted">Per vial: the supplier’s price → the cost with shipping, discounts and fees spread in.</p>
      </Card>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Card className="p-4 text-sm">
          <Totals plan={plan} paidBy={name(payer)} />
          {oldPlan && oldPlan.totalCents !== plan.totalCents && <p className="mt-2 text-xs text-warn">Saved order: {fmtMoney(oldPlan.totalCents)} · difference {fmtMoney(plan.totalCents - oldPlan.totalCents)}</p>}
        </Card>
        <Card className="p-4 text-sm" data-money-effect>
          <div className="mb-1 font-semibold">Effect on money</div>
          <div className="flex justify-between py-0.5">
            <span className="text-muted">Business money</span>
            <span className="tabular-nums">
              {fmtMoney(ledger.businessCents)} → <span className={cx("font-semibold", after.ledger.businessCents < 0 && "text-neg")}>{fmtMoney(after.ledger.businessCents)}</span>
            </span>
          </div>
          {holders.map((h) => (
            <div key={h} className="flex justify-between py-0.5">
              <span className="text-muted">{name(h)}&apos;s cash held</span>
              <span className="tabular-nums">
                {fmtMoney(cashNow[h])} → <span className={cx("font-semibold", after.cash[h] < 0 && "text-neg")}>{fmtMoney(after.cash[h])}</span>
              </span>
            </div>
          ))}
          {after.ledger.inPayback && <p className="mt-2 text-xs text-neg">Business money will be below $0: payback mode. Every sale goes to the business, nothing is split, until it is back to $0.</p>}
          <p className="mt-2 text-xs text-muted">The money comes out of {payer === "bank" ? "the bank" : `${name(payer)}'s cash held (paid out of pocket)`}.</p>
        </Card>
      </div>
      {negatives.length > 0 && <p className="mt-3 text-sm font-medium text-neg">Stock would go below 0 for {negatives.map(label).join(", ")}: those units were already sold.</p>}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Button variant="primary" size="lg" block disabled={busy || !!plan.error || !draft.paidBy} onClick={onYes} className="h-14 text-base" data-yes-save>
          <Check size={20} /> {busy ? "Saving…" : "Yes, save restock"}
        </Button>
        <Button size="lg" block onClick={onNo} disabled={busy} className="h-14 text-base" data-no-edit>
          <ArrowLeft size={20} /> No, go back and edit
        </Button>
      </div>
      {onDelete && (
        <div className="mt-6 border-t border-line pt-4">
          <Button variant="ghost" className="text-neg" onClick={onDelete} data-delete-restock>
            <Trash2 size={16} /> Delete this restock
          </Button>
        </div>
      )}
    </div>
  );
}
