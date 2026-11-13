"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Boxes, PackagePlus, Pencil, Plus, SlidersVertical } from "lucide-react";
import { List, ListRow } from "@/components/list";
import { api, useLoaded } from "@/components/store";
import {
  Badge,
  Button,
  Empty,
  Field,
  Input,
  MoneyInput,
  NumberInput,
  PageHeader,
  PageSkeleton,
  SectionTitle,
  Segmented,
  Select,
  Sheet,
  Toggle,
  cx,
  useConfirm,
} from "@/components/ui";
import {
  PRODUCT_COLORS,
  colorHex,
  fmtDate,
  fmtMoney,
  fromLocalInput,
  toLocalDateInput,
  uid,
} from "@/lib/format";
import type { AdjustmentReason, AdjustmentRec, ProductRec, PurchaseRec } from "@/lib/types";

type ProductDraft = Omit<ProductRec, "createdAt">;

export default function InventoryPage() {
  const s = useLoaded();
  const [productEdit, setProductEdit] = useState<ProductDraft | null>(null);
  const [isNewProduct, setIsNewProduct] = useState(false);
  const [restock, setRestock] = useState<PurchaseRec | null>(null);
  const [adjust, setAdjust] = useState<AdjustmentRec | null>(null);
  const [reorder, setReorder] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [historyTab, setHistoryTab] = useState<"restocks" | "adjustments">("restocks");

  const newProduct = () => {
    setIsNewProduct(true);
    setProductEdit({
      id: uid(),
      name: "",
      defaultPriceCents: 0,
      costOverrideCents: null,
      lowStockThreshold: null,
      color: "indigo",
      sortOrder: s ? s.data.products.length : 0,
      archived: false,
    });
  };

  useEffect(() => {
    if (s && new URLSearchParams(window.location.search).get("add") === "1") {
      window.history.replaceState(null, "", "/inventory");
      newProduct();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!s]);

  if (!s) return <PageSkeleton />;
  const { data, ledger, mutate } = s;
  const active = data.products.filter((p) => !p.archived);
  const archived = data.products.filter((p) => p.archived);
  const productName = (id: string) => data.products.find((p) => p.id === id)?.name ?? "Unknown";

  const startRestock = (productId: string) =>
    setRestock({
      id: "",
      date: new Date().toISOString(),
      productId,
      quantity: 1,
      totalCostCents: 0,
      note: "",
      fromInvestment: false,
      createdAt: "",
    });
  const startAdjust = (productId: string) =>
    setAdjust({ id: "", date: new Date().toISOString(), productId, quantity: -1, reason: "breakage", note: "", createdAt: "" });

  function move(id: string, dir: -1 | 1) {
    const ids = active.map((p) => p.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const order = [...ids, ...archived.map((p) => p.id)];
    mutate(
      (d) => ({
        ...d,
        products: order.map((pid, k) => ({ ...d.products.find((p) => p.id === pid)!, sortOrder: k })),
      }),
      () => api("/api/products/reorder", "POST", { ids: order }),
    );
  }

  const card = (p: ProductRec) => {
    const st = ledger.stock.get(p.id);
    const stock = st?.stock ?? 0;
    const cost = st?.unitCost ?? 0;
    const margin = p.defaultPriceCents > 0 ? ((p.defaultPriceCents - cost) / p.defaultPriceCents) * 100 : null;
    const low = p.lowStockThreshold ?? data.settings.lowStockThreshold;
    return (
      <div key={p.id} className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-start gap-3">
          <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: colorHex(p.color) }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">{p.name}</span>
              {p.archived && <Badge>Archived</Badge>}
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2 text-sm">
              <Stat label="Stock" value={String(stock)} tone={stock <= 0 ? "neg" : stock <= low ? "warn" : undefined} />
              <Stat label="Cost" value={fmtMoney(cost)} hint={p.costOverrideCents !== null ? "set" : undefined} />
              <Stat label="Price" value={fmtMoney(p.defaultPriceCents)} />
              <Stat label="Margin" value={margin === null ? "—" : `${margin.toFixed(0)}%`} tone={margin !== null && margin < 0 ? "neg" : undefined} />
            </div>
          </div>
          {reorder && !p.archived ? (
            <div className="flex flex-col">
              <button aria-label="Move up" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface2" onClick={() => move(p.id, -1)}>
                <ArrowUp size={18} />
              </button>
              <button aria-label="Move down" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface2" onClick={() => move(p.id, 1)}>
                <ArrowDown size={18} />
              </button>
            </div>
          ) : (
            <button
              aria-label="Edit product"
              className="-mr-2 -mt-2 flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface2 hover:text-ink"
              onClick={() => {
                setIsNewProduct(false);
                setProductEdit({ ...p });
              }}
            >
              <Pencil size={17} />
            </button>
          )}
        </div>
        {!reorder && (
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="soft" className="flex-1" onClick={() => startRestock(p.id)}>
              <PackagePlus size={16} /> Restock
            </Button>
            <Button size="sm" className="flex-1" onClick={() => startAdjust(p.id)}>
              <SlidersVertical size={16} /> Adjust
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="Inventory"
        actions={
          <>
            {active.length > 1 && (
              <Button variant={reorder ? "soft" : "ghost"} onClick={() => setReorder((v) => !v)} aria-label="Reorder">
                <ArrowUpDown size={18} />
                <span className="hidden sm:inline">{reorder ? "Done" : "Reorder"}</span>
              </Button>
            )}
            <Button variant="primary" onClick={newProduct}>
              <Plus size={18} /> Product
            </Button>
          </>
        }
      />

      {data.products.length === 0 ? (
        <Empty
          icon={<Boxes size={32} />}
          title="No products yet"
          body="Add your first one. Then restock it to set stock and cost."
          action={
            <Button variant="primary" onClick={newProduct}>
              Add your first product
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">{active.map(card)}</div>
          {archived.length > 0 && (
            <>
              <SectionTitle
                right={
                  <button className="text-sm font-medium text-accent" onClick={() => setShowArchived((v) => !v)}>
                    {showArchived ? "Hide" : "Show"}
                  </button>
                }
              >
                Archived ({archived.length})
              </SectionTitle>
              {showArchived && <div className="grid gap-3 md:grid-cols-2">{archived.map(card)}</div>}
            </>
          )}

          <SectionTitle>History</SectionTitle>
          <Segmented
            className="mb-3 max-w-xs"
            size="sm"
            value={historyTab}
            onChange={setHistoryTab}
            options={[
              { value: "restocks", label: "Restocks" },
              { value: "adjustments", label: "Adjustments" },
            ]}
          />
          {historyTab === "restocks" ? (
            data.purchases.length === 0 ? (
              <Empty title="No restocks yet" body="Tap Restock on a product to log a purchase." />
            ) : (
              <List>
                {[...data.purchases]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((p) => (
                    <ListRow
                      key={p.id}
                      onClick={() => setRestock({ ...p })}
                      title={`${productName(p.productId)} · +${p.quantity}`}
                      sub={`${fmtDate(p.date)} · ${fmtMoney(Math.round(p.totalCostCents / p.quantity))}/unit${p.note ? ` · ${p.note}` : ""}`}
                      right={
                        <div className="text-right">
                          <div className="font-medium tabular-nums">{fmtMoney(p.totalCostCents)}</div>
                          {p.fromInvestment && <div className="text-xs text-muted">from investment</div>}
                        </div>
                      }
                    />
                  ))}
              </List>
            )
          ) : data.adjustments.length === 0 ? (
            <Empty title="No adjustments yet" body="Use Adjust for breakage, freebies or count corrections." />
          ) : (
            <List>
              {[...data.adjustments]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((a) => (
                  <ListRow
                    key={a.id}
                    onClick={() => setAdjust({ ...a })}
                    title={productName(a.productId)}
                    sub={`${fmtDate(a.date)} · ${a.reason}${a.note ? ` · ${a.note}` : ""}`}
                    right={<span className={cx("font-medium tabular-nums", a.quantity < 0 ? "text-neg" : "text-pos")}>{a.quantity > 0 ? `+${a.quantity}` : a.quantity}</span>}
                  />
                ))}
            </List>
          )}
        </>
      )}

      <ProductSheet value={productEdit} isNew={isNewProduct} onClose={() => setProductEdit(null)} />
      <RestockSheet value={restock} onClose={() => setRestock(null)} />
      <AdjustSheet value={adjust} onClose={() => setAdjust(null)} />
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: "neg" | "warn"; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">
        {label}
        {hint && <span className="ml-1 text-accent">• {hint}</span>}
      </div>
      <div className={cx("truncate font-medium tabular-nums", tone === "neg" && "text-neg", tone === "warn" && "text-warn")}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Product sheet
function ProductSheet({ value, isNew, onClose }: { value: ProductDraft | null; isNew: boolean; onClose: () => void }) {
  const s = useLoaded();
  const confirm = useConfirm();
  const [p, setP] = useState<ProductDraft | null>(value);
  useEffect(() => setP(value), [value]);
  if (!s) return null;
  const st = p ? s.ledger.stock.get(p.id) : undefined;

  async function save() {
    if (!p || !p.name.trim()) return;
    const rec = { ...p, name: p.name.trim() };
    onClose();
    const { id, ...rest } = rec;
    await s!.mutate(
      (d) => ({
        ...d,
        products: isNew
          ? [...d.products, { ...rec, createdAt: new Date().toISOString() }]
          : d.products.map((x) => (x.id === id ? { ...x, ...rec } : x)),
      }),
      () => (isNew ? api("/api/products", "POST", rec) : api(`/api/products/${id}`, "PATCH", rest)),
    );
  }

  async function remove() {
    if (!p) return;
    const ok = await confirm({
      title: `Delete ${p.name}?`,
      body: "Its restocks and stock adjustments are deleted too (which changes business money). Past sales are kept. To keep everything, archive it instead.",
      confirmText: "Delete product",
      danger: true,
    });
    if (!ok) return;
    onClose();
    await s!.mutate(
      (d) => ({
        ...d,
        products: d.products.filter((x) => x.id !== p.id),
        purchases: d.purchases.filter((x) => x.productId !== p.id),
        adjustments: d.adjustments.filter((x) => x.productId !== p.id),
      }),
      () => api(`/api/products/${p.id}`, "DELETE"),
    );
  }

  return (
    <Sheet
      open={!!value}
      onClose={onClose}
      title={isNew ? "New product" : "Edit product"}
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
          <Button block variant="primary" onClick={save} disabled={!p?.name.trim()}>
            Save
          </Button>
        </div>
      }
    >
      {p && (
        <div className="space-y-4">
          <Field label="Name">
            <Input value={p.name} autoFocus={isNew} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="e.g. Vial 10mg" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Default sell price">
              <MoneyInput value={p.defaultPriceCents} onChange={(c) => setP({ ...p, defaultPriceCents: c ?? 0 })} />
            </Field>
            <Field
              label="Cost per unit"
              hint={p.costOverrideCents === null ? `Auto: ${st?.avgCost != null ? fmtMoney(st.avgCost) : "from restocks"}` : "Manual override"}
            >
              <MoneyInput nullable placeholder={st?.avgCost != null ? (st.avgCost / 100).toFixed(2) : "auto"} value={p.costOverrideCents} onChange={(c) => setP({ ...p, costOverrideCents: c })} />
            </Field>
          </div>
          <Field label="Low stock warning" hint={`Leave empty to use the default (${s.data.settings.lowStockThreshold})`}>
            <NumberInput nullable value={p.lowStockThreshold} min={0} placeholder={String(s.data.settings.lowStockThreshold)} onChange={(n) => setP({ ...p, lowStockThreshold: n })} />
          </Field>
          <Field label="Color">
            <div className="flex flex-wrap gap-2">
              {Object.entries(PRODUCT_COLORS).map(([name, hex]) => (
                <button
                  key={name}
                  type="button"
                  aria-label={name}
                  onClick={() => setP({ ...p, color: name })}
                  className={cx("h-9 w-9 rounded-full transition active:scale-90", p.color === name && "ring-2 ring-ink ring-offset-2 ring-offset-surface")}
                  style={{ background: hex }}
                />
              ))}
            </div>
          </Field>
          {!isNew && <Toggle checked={p.archived} onChange={(v) => setP({ ...p, archived: v })} label="Archived" hint="Hidden from Sell, history kept" />}
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Restock sheet
function RestockSheet({ value, onClose }: { value: PurchaseRec | null; onClose: () => void }) {
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
    const body = { date: rec.date, productId: rec.productId, quantity: rec.quantity, totalCostCents: rec.totalCostCents, note: rec.note, fromInvestment: rec.fromInvestment };
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
          <Button block variant="primary" onClick={save} disabled={!p || p.quantity < 1}>
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
              <NumberInput value={p.quantity} min={0} onChange={(n) => setP({ ...p, quantity: n ?? 0 })} />
            </Field>
            <Field label="Total cost">
              <MoneyInput value={p.totalCostCents} onChange={(c) => setP({ ...p, totalCostCents: c ?? 0 })} />
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
function AdjustSheet({ value, onClose }: { value: AdjustmentRec | null; onClose: () => void }) {
  const s = useLoaded();
  const confirm = useConfirm();
  const [a, setA] = useState<AdjustmentRec | null>(value);
  useEffect(() => setA(value), [value]);
  if (!s) return null;
  const isNew = !value?.id;
  const dir = a && a.quantity < 0 ? -1 : 1;

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
          <Field label="Change">
            <div className="flex gap-2">
              <Segmented
                className="w-36"
                value={dir === -1 ? "minus" : "plus"}
                onChange={(v) => setA({ ...a, quantity: Math.abs(a.quantity || 1) * (v === "minus" ? -1 : 1) })}
                options={[
                  { value: "minus", label: "− Remove" },
                  { value: "plus", label: "+ Add" },
                ]}
              />
              <NumberInput className="flex-1" value={Math.abs(a.quantity)} min={0} onChange={(n) => setA({ ...a, quantity: (n ?? 0) * dir })} />
            </div>
          </Field>
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
