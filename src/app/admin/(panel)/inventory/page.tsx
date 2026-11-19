"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Boxes, Combine, FolderTree, Globe, GripVertical, PackagePlus, Pencil, Plus, SlidersVertical, Trash2 } from "lucide-react";
import { List, ListRow } from "@/components/list";
import { moved } from "@/components/inventory/media";
import { ProductSheet } from "@/components/inventory/product-sheet";
import { AdjustSheet, RestockSheet } from "@/components/inventory/stock-sheets";
import { api, useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Badge, Button, Empty, Field, Input, PageHeader, PageSkeleton, SectionTitle, Segmented, Sheet, cx, useConfirm } from "@/components/ui";
import { colorHex, fmtDate, fmtMoney, uid } from "@/lib/format";
import { sizeInName, websiteInfo } from "@/lib/store/product-info";
import type { AdjustmentRec, ListingRec, ProductRec, PurchaseRec } from "@/lib/types";
import { TESTING_LABEL } from "@/lib/types";

export default function InventoryPage() {
  const s = useLoaded();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [restock, setRestock] = useState<PurchaseRec | null>(null);
  const [adjust, setAdjust] = useState<AdjustmentRec | null>(null);
  const [reorder, setReorder] = useState(false);
  const [combine, setCombine] = useState(false);
  const [groups, setGroups] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [webFilter, setWebFilter] = useState<"all" | "on" | "off">("all");
  const [historyTab, setHistoryTab] = useState<"restocks" | "adjustments">("restocks");
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  useEffect(() => {
    if (!s) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("add") === "1") setEditing("new");
    else if (q.get("open")) setEditing(q.get("open"));
    if (q.size) window.history.replaceState(null, "", "/admin/inventory");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!s]);

  const rows = useMemo(() => {
    if (!s) return [];
    return s.data.listings.map((l) => {
      const variants = s.data.products.filter((p) => p.listingId === l.id).sort((a, b) => a.variantSort - b.variantSort || a.sortOrder - b.sortOrder);
      return { l, variants, archived: variants.length > 0 && variants.every((v) => v.archived) };
    });
  }, [s]);

  if (!s) return <PageSkeleton />;
  const { data, ledger, mutate } = s;
  const active = rows.filter((r) => !r.archived);
  // Reordering always works on the full list, so the filter is ignored while reordering.
  const shown = reorder || webFilter === "all" ? active : active.filter((r) => r.l.showOnWebsite === (webFilter === "on"));
  const onWebsite = active.filter((r) => r.l.showOnWebsite).length;
  const archived = rows.filter((r) => r.archived);
  const productName = (id: string) => data.products.find((p) => p.id === id)?.name ?? "Unknown";

  const startRestock = (productId: string) => setRestock({ id: "", date: new Date().toISOString(), productId, quantity: 1, totalCostCents: 0, note: "", fromInvestment: false, createdAt: "" });
  const startAdjust = (productId: string) => setAdjust({ id: "", date: new Date().toISOString(), productId, quantity: -1, reason: "breakage", note: "", createdAt: "" });

  function saveOrder(next: typeof active) {
    const ids = [...next.map((r) => r.l.id), ...archived.map((r) => r.l.id)];
    mutate(
      (d) => ({ ...d, listings: ids.map((id, k) => ({ ...d.listings.find((x) => x.id === id)!, sortOrder: k })) }),
      () => api("/api/listings", "POST", { action: "reorder", ids }),
    );
  }

  const variantRow = (p: ProductRec, multi: boolean) => {
    const st = ledger.stock.get(p.id);
    const stock = st?.stock ?? 0;
    const cost = st?.unitCost ?? 0;
    const margin = p.defaultPriceCents > 0 ? ((p.defaultPriceCents - cost) / p.defaultPriceCents) * 100 : null;
    const low = p.lowStockThreshold ?? data.settings.lowStockThreshold;
    return (
      <div key={p.id} className={cx("py-3", multi && "border-t border-line first:border-t-0")}>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorHex(p.color) }} />
          {multi ? (
            <span className="truncate text-sm font-semibold">{p.variantLabel || p.name}</span>
          ) : (
            <span className="truncate text-sm font-semibold">{p.variantLabel.trim() ? `Size ${p.variantLabel.trim()}` : <span className="font-normal text-muted">No size set</span>}</span>
          )}
          {p.vialVolume.trim() && <span className="text-sm text-muted">{p.vialVolume.trim()}</span>}
          {p.archived && <Badge>Archived</Badge>}
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2 text-sm">
          <Stat label="Stock" value={String(stock)} tone={stock <= 0 ? "neg" : stock <= low ? "warn" : undefined} />
          <Stat label="Cost" value={fmtMoney(cost)} hint={p.costOverrideCents !== null ? "set" : undefined} />
          <Stat label="Price" value={fmtMoney(p.defaultPriceCents)} />
          <Stat label="Margin" value={margin === null ? "—" : `${margin.toFixed(0)}%`} tone={margin !== null && margin < 0 ? "neg" : undefined} />
        </div>
        {!reorder && (
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="soft" className="h-10 flex-1" onClick={() => startRestock(p.id)}>
              <PackagePlus size={16} /> Restock
            </Button>
            <Button size="sm" className="h-10 flex-1" onClick={() => startAdjust(p.id)}>
              <SlidersVertical size={16} /> Adjust
            </Button>
          </div>
        )}
      </div>
    );
  };

  const card = ({ l, variants }: (typeof rows)[number], i: number, sortable: boolean) => {
    const multi = variants.length > 1;
    const withCoa = variants.filter((v) => data.coas.some((c) => c.productId === v.id && c.isCurrent)).length;
    const info = websiteInfo(l);
    return (
      <div
        key={l.id}
        draggable={sortable}
        onDragStart={() => sortable && setDrag(i)}
        onDragEnd={() => (setDrag(null), setOver(null))}
        onDragOver={(e) => sortable && (e.preventDefault(), setOver(i))}
        onDrop={(e) => {
          if (!sortable) return;
          e.preventDefault();
          if (drag !== null && drag !== i) saveOrder(moved(active, drag, i));
          setDrag(null);
          setOver(null);
        }}
        className={cx("rounded-2xl border bg-surface p-4", sortable && "cursor-grab", sortable && over === i && drag !== null && drag !== i ? "border-accent ring-2 ring-accent/30" : "border-line", drag === i && "opacity-40")}
      >
        <div className="flex items-start gap-2">
          {sortable && <GripVertical size={18} className="mt-0.5 hidden shrink-0 text-muted sm:block" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold">{l.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {l.showOnWebsite ? (
                <Badge tone="pos">
                  <Globe size={11} className="mr-1" /> On website
                </Badge>
              ) : (
                <Badge>Not on website</Badge>
              )}
              {multi && <Badge tone="accent">{variants.length} sizes</Badge>}
              <Badge tone={info.filled === info.total ? "pos" : l.showOnWebsite ? "warn" : "neutral"}>
                <span title={info.missing.length ? `Missing: ${info.missing.join(", ")}` : "All compound info is filled in"}>{info.label}</span>
              </Badge>
              {sizeInName(l.name) && <Badge tone="warn">Size in name</Badge>}
              {l.showOnWebsite && l.photos.length === 0 && <Badge tone="warn">No photo</Badge>}
              {l.showOnWebsite && <Badge tone={withCoa === variants.length ? "neutral" : "warn"}>{withCoa === variants.length ? "COA on file" : multi ? `COA ${withCoa}/${variants.length}` : TESTING_LABEL[variants[0]?.testingStatus ?? "coming_soon"]}</Badge>}
            </div>
          </div>
          {sortable ? (
            <div className="flex shrink-0">
              <button aria-label={`Move ${l.name} up`} disabled={i === 0} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface2 disabled:opacity-25" onClick={() => saveOrder(moved(active, i, i - 1))}>
                <ArrowUp size={18} />
              </button>
              <button aria-label={`Move ${l.name} down`} disabled={i === active.length - 1} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface2 disabled:opacity-25" onClick={() => saveOrder(moved(active, i, i + 1))}>
                <ArrowDown size={18} />
              </button>
            </div>
          ) : (
            <Button size="sm" className="h-10 shrink-0" onClick={() => setEditing(l.id)}>
              <Pencil size={15} /> Edit
            </Button>
          )}
        </div>
        {!sortable && <div className="mt-1">{variants.map((v) => variantRow(v, multi))}</div>}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="Inventory"
        sub="Every product, for the Sell screen and the website."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus size={18} /> Product
          </Button>
        }
      />

      {data.sizeBackfill && data.sizeBackfill.items.length > 0 && (
        <details data-size-backfill className="mb-4 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Sizes filled in from product names ({data.sizeBackfill.items.length}) on {fmtDate(data.sizeBackfill.ranAt)}
          </summary>
          <p className="mt-2 text-muted">Only empty sizes were filled. Products with no size in the name were left blank. Change any of them on the product’s Stock and pricing tab.</p>
          <ul className="mt-2 divide-y divide-line">
            {data.sizeBackfill.items.map((f) => (
              <li key={f.productId} className="flex justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">{f.product}</span>
                <span className="shrink-0 font-semibold tabular-nums">{f.size}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {data.products.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {active.length > 1 && (
            <Button size="sm" className="h-10" variant={reorder ? "soft" : "secondary"} onClick={() => setReorder((v) => !v)}>
              <ArrowUpDown size={16} /> {reorder ? "Done reordering" : "Reorder"}
            </Button>
          )}
          {data.products.length > 1 && (
            <Button size="sm" className="h-10" onClick={() => setCombine(true)}>
              <Combine size={16} /> Combine into one product
            </Button>
          )}
          <Button size="sm" className="h-10" onClick={() => setGroups(true)}>
            <FolderTree size={16} /> Groups{data.groups.length ? ` (${data.groups.length})` : ""}
          </Button>
        </div>
      )}
      {rows.length > 0 && !reorder && (
        <Segmented
          className="mb-4 max-w-md"
          value={webFilter}
          onChange={setWebFilter}
          options={[
            { value: "all", label: `All (${active.length})` },
            { value: "on", label: `On website (${onWebsite})` },
            { value: "off", label: `Not on website (${active.length - onWebsite})` },
          ]}
        />
      )}
      {reorder && <p className="mb-3 text-sm text-muted">Drag products into the order you want, or use the arrows. This is the order on the Sell screen and in the shop.</p>}

      {rows.length === 0 ? (
        <Empty
          icon={<Boxes size={32} />}
          title="No products yet"
          body="Add your first one. Then restock it to set stock and cost."
          action={
            <Button variant="primary" onClick={() => setEditing("new")}>
              Add your first product
            </Button>
          }
        />
      ) : (
        <>
          <div className={cx("grid gap-3", reorder ? "md:grid-cols-1" : "md:grid-cols-2")}>{shown.map((r, i) => card(r, i, reorder))}</div>
          {shown.length === 0 && (
            <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
              {webFilter === "on" ? "No products are on the website yet. Open a product, go to the Website tab and switch on “Show on website”." : "Every product is on the website."}
            </p>
          )}
          {archived.length > 0 && (
            <>
              <SectionTitle
                right={
                  <button className="h-10 px-2 text-sm font-medium text-accent" onClick={() => setShowArchived((v) => !v)}>
                    {showArchived ? "Hide" : "Show"}
                  </button>
                }
              >
                Archived ({archived.length})
              </SectionTitle>
              {showArchived && <div className="grid gap-3 md:grid-cols-2">{archived.map((r, i) => card(r, i, false))}</div>}
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

      <ProductSheet listingId={editing} onClose={() => setEditing(null)} />
      <RestockSheet value={restock} onClose={() => setRestock(null)} />
      <AdjustSheet value={adjust} onClose={() => setAdjust(null)} />
      <CombineSheet open={combine} onClose={() => setCombine(false)} onDone={(id) => setEditing(id)} />
      <GroupsSheet open={groups} onClose={() => setGroups(false)} />
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

// ---------------------------------------------------------------- Combine into one product
/** Guess the shared name and each size label: "BPC-157 5mg" + "BPC-157 10mg" -> "BPC-157", ["5mg", "10mg"]. */
function guessCombine(names: string[]): { name: string; labels: string[] } {
  if (names.length === 0) return { name: "", labels: [] };
  const words = names.map((n) => n.trim().split(/\s+/));
  let k = 0;
  while (words.every((w) => w.length > k + 1 && w[k].toLowerCase() === words[0][k].toLowerCase())) k++;
  return { name: words[0].slice(0, k).join(" "), labels: words.map((w) => w.slice(k).join(" ")) };
}

function CombineSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (listingId: string) => void }) {
  const s = useLoaded();
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) (setPicked([]), setName(""), setLabels({}), setTouched(false));
  }, [open]);

  if (!s) return null;
  const products = s.data.products.filter((p) => !p.archived);
  const byId = new Map(products.map((p) => [p.id, p]));

  function toggle(id: string) {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    if (!touched) {
      const g = guessCombine(next.map((x) => byId.get(x)!.name));
      setName(g.name);
      setLabels(Object.fromEntries(next.map((x, i) => [x, byId.get(x)!.variantLabel || g.labels[i] || ""])));
    }
  }

  async function run() {
    setBusy(true);
    try {
      const r = await api<{ id: string }>("/api/listings", "POST", { action: "combine", input: { name, items: picked.map((id) => ({ productId: id, label: labels[id] ?? "" })) } });
      await s!.refresh();
      toast.show({ message: `Combined into ${name}. Each size kept its stock, cost, price and history.`, tone: "success", duration: 5000 });
      onClose();
      onDone(r.id);
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: "error", duration: 7000 });
    }
    setBusy(false);
  }

  const ready = picked.length >= 2 && name.trim() && picked.every((id) => (labels[id] ?? "").trim());
  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title="Combine into one product"
      footer={
        <div className="flex gap-2">
          <Button block onClick={onClose}>
            Cancel
          </Button>
          <Button block variant="primary" disabled={!ready || busy} onClick={run}>
            {busy ? "Combining…" : `Combine ${picked.length || ""} ${picked.length === 1 ? "product" : "products"}`}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <p className="text-[15px] text-muted">
          Pick products that are the same compound in different sizes. They become sizes of one product. Each size keeps its own stock, cost, price and sales history. Nothing changes until you press Combine, and you can undo it with “Split variant out”.
        </p>
        <div>
          <div className="mb-2 text-sm font-medium text-muted">1. Pick the products</div>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {products.map((p) => {
              const on = picked.includes(p.id);
              return (
                <li key={p.id}>
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2.5">
                    <input type="checkbox" checked={on} onChange={() => toggle(p.id)} className="h-5 w-5 accent-[rgb(var(--accent))]" />
                    <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                    <span className="shrink-0 text-sm tabular-nums text-muted">
                      {fmtMoney(p.defaultPriceCents)} · {s.ledger.stock.get(p.id)?.stock ?? 0} in stock
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
        {picked.length >= 2 && (
          <>
            <Field label="2. Name of the combined product" hint="What customers see, without the size.">
              <Input value={name} onChange={(e) => (setTouched(true), setName(e.target.value))} placeholder="e.g. BPC-157" />
            </Field>
            <div>
              <div className="mb-2 text-sm font-medium text-muted">3. Label each size</div>
              <div className="space-y-2">
                {picked.map((id) => (
                  <div key={id} className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-3">
                    <span className="truncate text-[15px]">{byId.get(id)?.name}</span>
                    <Input value={labels[id] ?? ""} placeholder="e.g. 10mg" onChange={(e) => (setTouched(true), setLabels({ ...labels, [id]: e.target.value }))} aria-label={`Size label for ${byId.get(id)?.name}`} />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Groups
function GroupsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useLoaded();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  if (!s) return null;
  const { data, mutate } = s;
  const send = (payload: Record<string, unknown>) => mutate(null, () => api("/api/groups", "POST", payload));
  const count = (id: string) => data.listings.filter((l: ListingRec) => l.groupIds.includes(id)).length;

  return (
    <Sheet open={open} onClose={onClose} title="Groups">
      <div className="space-y-4">
        <p className="text-[15px] text-muted">Groups are shown as Collections on the store, and can be used to limit a discount code. Add products to a group from the product’s Website tab.</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            send({ action: "create", group: { id: uid(), name: name.trim() } });
            setName("");
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New group, e.g. Recovery" maxLength={60} aria-label="New group name" />
          <Button type="submit" variant="primary" className="h-12 shrink-0" disabled={!name.trim()}>
            Add
          </Button>
        </form>
        {data.groups.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">No groups yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {data.groups.map((g, i) => (
              <li key={g.id} className="flex items-center gap-1 px-2 py-1.5">
                <div className="flex shrink-0 flex-col">
                  <button aria-label={`Move ${g.name} up`} disabled={i === 0} className="flex h-6 w-9 items-center justify-center text-muted disabled:opacity-25" onClick={() => send({ action: "reorder", ids: moved(data.groups, i, i - 1).map((x) => x.id) })}>
                    <ArrowUp size={15} />
                  </button>
                  <button aria-label={`Move ${g.name} down`} disabled={i === data.groups.length - 1} className="flex h-6 w-9 items-center justify-center text-muted disabled:opacity-25" onClick={() => send({ action: "reorder", ids: moved(data.groups, i, i + 1).map((x) => x.id) })}>
                    <ArrowDown size={15} />
                  </button>
                </div>
                <GroupName key={g.name} name={g.name} onSave={(n) => send({ action: "rename", group: { id: g.id, name: n } })} />
                <span className="shrink-0 px-2 text-sm tabular-nums text-muted">{count(g.id)} products</span>
                <button
                  aria-label={`Delete ${g.name}`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-neg/10 hover:text-neg"
                  onClick={async () => {
                    if (await confirm({ title: `Delete the group ${g.name}?`, body: "Products stay. They are only taken out of this group.", confirmText: "Delete group", danger: true })) send({ action: "delete", id: g.id });
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

function GroupName({ name, onSave }: { name: string; onSave: (n: string) => void }) {
  const [v, setV] = useState(name);
  return (
    <input
      value={v}
      maxLength={60}
      aria-label="Group name"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => (v.trim() && v.trim() !== name ? onSave(v.trim()) : setV(name))}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="h-10 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-[15px] font-medium hover:border-line focus:border-accent focus:outline-none"
    />
  );
}
