"use client";

// Edit one product. Two tabs: "Stock and pricing" (the CRM fields, per size) and "Website"
// (everything the store shows). One product list: nothing here is duplicated anywhere else.
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, FileText, Plus, Split, Trash2, TriangleAlert, Upload } from "lucide-react";
import { api, useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Badge, Button, Field, Input, MoneyInput, NumberInput, Segmented, Select, Sheet, Textarea, Toggle, cx, useConfirm } from "@/components/ui";
import { emptyListing } from "@/lib/backup";
import { PRODUCT_COLORS, fmtDate, fmtMoney, toLocalDateInput, uid } from "@/lib/format";
import { INFO_FIELDS, nameWithoutSize, sizeInName, websiteInfo } from "@/lib/store/product-info";
import { slugify } from "@/lib/store/slug";
import type { CoaRec, ListingRec, ProductRec, QtyDeal, TestingStatus } from "@/lib/types";
import { PRODUCT_DEFAULTS, TESTING_LABEL } from "@/lib/types";
import { PhotoManager, uploadFile } from "./media";

type Variant = ProductRec & { isNew?: boolean };
const PRESET_BADGES = ["Best seller", "Popular", "New"];
const TESTING_HINT: Record<TestingStatus, string> = {
  coa_available: "Shows “COA available” with the purity and a View COA button.",
  supplier_tested: "Shows “Tested by supplier”. Upload the supplier’s COA below.",
  pending: "Shows “Third-party testing pending”. Still purchasable.",
  coming_soon: "Shows “COA coming soon”. Still purchasable.",
};

const newVariant = (listingId: string, name: string, n: number): Variant => ({
  id: uid(),
  name,
  defaultPriceCents: 0,
  costOverrideCents: null,
  lowStockThreshold: null,
  color: "red",
  sortOrder: 0,
  archived: false,
  createdAt: new Date().toISOString(),
  ...PRODUCT_DEFAULTS,
  listingId,
  variantSort: n,
  isNew: true,
});

export function ProductSheet({ listingId, onClose }: { listingId: string | "new" | null; onClose: () => void }) {
  const s = useLoaded();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<"stock" | "website">("stock");
  const [l, setL] = useState<ListingRec | null>(null);
  const [vs, setVs] = useState<Variant[]>([]);
  const [saving, setSaving] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const isNew = listingId === "new";

  useEffect(() => {
    if (!s || !listingId) return;
    setTab("stock");
    setSlugTouched(false);
    if (listingId === "new") {
      const id = uid();
      setL(emptyListing(id, "", "", s.data.listings.length));
      setVs([newVariant(id, "", 0)]);
    } else {
      const found = s.data.listings.find((x) => x.id === listingId);
      setL(found ? { ...found } : null);
      setVs(s.data.products.filter((p) => p.listingId === listingId).sort((a, b) => a.variantSort - b.variantSort || a.sortOrder - b.sortOrder).map((p) => ({ ...p })));
    }
    // Only when a different product is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId, !!s]);

  const original = useMemo(() => (s && listingId && listingId !== "new" ? s.data.products.filter((p) => p.listingId === listingId) : []), [s, listingId]);
  if (!s) return null;
  const { data, ledger, mutate, refresh } = s;
  const multi = vs.length > 1;
  const setV = (id: string, patch: Partial<Variant>) => setVs((list) => list.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const setField = <K extends keyof ListingRec>(k: K, v: ListingRec[K]) => setL((x) => (x ? { ...x, [k]: v } : x));

  /** Name on the Sell screen for a size: "BPC-157 10mg". */
  const sellName = (v: Variant, productName = l?.name ?? "") => (v.variantLabel.trim() ? `${productName.trim()} ${v.variantLabel.trim()}`.trim() : productName.trim());

  function rename(name: string) {
    if (!l) return;
    // Sizes whose Sell-screen name followed the product name keep following it.
    setVs((list) => list.map((v) => (v.name === sellName(v, l.name) || !v.name ? { ...v, name: sellName(v, name) } : v)));
    setL({ ...l, name });
  }

  async function save() {
    if (!l) return;
    const name = l.name.trim();
    if (!name) return toast.show({ message: "Give the product a name.", tone: "error" });
    if (multi) {
      const labels = vs.map((v) => v.variantLabel.trim().toLowerCase());
      if (labels.some((x) => !x)) return (setTab("stock"), toast.show({ message: "Every size needs a label, like 5mg or 10mg.", tone: "error" }));
      if (new Set(labels).size !== labels.length) return (setTab("stock"), toast.show({ message: "Two sizes have the same label. Make each one different.", tone: "error" }));
    }
    setSaving(true);
    const variantBody = (v: Variant) => ({
      name: v.name.trim() || sellName(v, name),
      variantLabel: v.variantLabel.trim(),
      defaultPriceCents: v.defaultPriceCents,
      costOverrideCents: v.costOverrideCents,
      lowStockThreshold: v.lowStockThreshold,
      weightOz: v.weightOz,
      testingStatus: v.testingStatus,
      color: v.color,
    });
    const web = {
      name,
      slug: slugTouched || !isNew ? l.slug : "",
      summary: l.summary,
      description: l.description,
      casNumber: l.casNumber,
      formula: l.formula,
      molecularWeight: l.molecularWeight,
      purity: l.purity,
      form: l.form,
      storage: l.storage,
      showOnWebsite: l.showOnWebsite,
      photos: l.photos,
      hoverGif: l.hoverGif,
      groupIds: l.groupIds,
      badges: l.badges,
      bestSeller: l.bestSeller,
      qtyDeals: l.qtyDeals,
      seoTitle: l.seoTitle,
      seoDescription: l.seoDescription,
    };
    const ok = await mutate(null, async () => {
      if (isNew) {
        await api("/api/listings", "POST", { action: "create", listing: { id: l.id, name, variant: { id: vs[0].id, ...variantBody(vs[0]) } } });
        for (const v of vs.slice(1)) await api("/api/products", "POST", { id: v.id, listingId: l.id, ...variantBody(v) });
      } else {
        for (const v of vs) {
          if (v.isNew) await api("/api/products", "POST", { id: v.id, listingId: l.id, ...variantBody(v) });
          else {
            const before = original.find((p) => p.id === v.id);
            const body = { ...variantBody(v), archived: v.archived };
            const changed = !before || (Object.keys(body) as (keyof typeof body)[]).some((k) => body[k] !== before[k]);
            if (changed) await api(`/api/products/${v.id}`, "PATCH", body);
          }
        }
      }
      await api(`/api/listings/${l.id}`, "PATCH", web);
      if (vs.length > 1) await api("/api/listings", "POST", { action: "reorder-variants", ids: vs.map((v) => v.id) });
    });
    setSaving(false);
    if (ok) {
      toast.show({ message: isNew ? "Product added. Restock it to set stock and cost." : "Product saved", tone: "success" });
      onClose();
    }
  }

  async function splitOut(v: Variant) {
    const ok = await confirm({
      title: `Split ${v.variantLabel || v.name} into its own product?`,
      body: "It becomes a separate product again (hidden from the website until you switch it on). Its stock, cost, price and sales history stay exactly as they are.",
      confirmText: "Split out",
    });
    if (!ok) return;
    const done = await mutate(null, () => api("/api/listings", "POST", { action: "split", productId: v.id }));
    if (done) {
      setVs((list) => list.filter((x) => x.id !== v.id));
      toast.show({ message: "Split out. Find it in the product list.", tone: "success" });
    }
  }

  async function removeVariant(v: Variant) {
    if (v.isNew) return setVs((list) => list.filter((x) => x.id !== v.id));
    const last = vs.filter((x) => !x.isNew).length === 1;
    const ok = await confirm({
      title: `Delete ${v.name}?`,
      body: `Its restocks, stock adjustments and COAs are deleted too (which changes business money). Past sales are kept.${last ? " This is the only size, so the product is removed as well." : ""} To keep everything, archive it instead.`,
      confirmText: "Delete",
      danger: true,
    });
    if (!ok) return;
    const done = await mutate(null, () => api(`/api/products/${v.id}`, "DELETE"));
    if (done) {
      if (last) onClose();
      else setVs((list) => list.filter((x) => x.id !== v.id));
    }
  }

  // A size inside the product name ("Reta 10mg"): sizes belong in the size label.
  const nameSize = l ? sizeInName(l.name) : "";
  const canMoveSize = !!l && !!nameSize && vs.length === 1 && !vs[0].variantLabel.trim() && !!nameWithoutSize(l.name);
  function moveSizeToLabel() {
    if (!l || !canMoveSize) return;
    const clean = nameWithoutSize(l.name);
    // The Sell screen name stays what it was ("Reta 10mg"), so sales history reads the same.
    setVs((list) => list.map((v) => ({ ...v, variantLabel: nameSize, name: v.name.trim() || l.name.trim() })));
    setL({ ...l, name: clean });
  }
  const info = l ? websiteInfo(l) : null;
  const infoEmpty = (key: (typeof INFO_FIELDS)[number]["key"]) => (l && !l[key].trim() ? "Recommended" : undefined);

  const storeDeals = data.store.qtyDeals;
  const deals = l?.qtyDeals ?? null;

  return (
    <Sheet
      open={!!listingId}
      onClose={onClose}
      wide
      title={isNew ? "New product" : l?.name || "Edit product"}
      footer={
        <div className="flex gap-2">
          <Button block onClick={onClose}>
            Cancel
          </Button>
          <Button block variant="primary" onClick={save} disabled={saving || !l?.name.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      {l && (
        <div>
          <Segmented
            className="sticky top-0 z-10 mb-5 shadow-[0_8px_12px_-8px_rgb(var(--surface))]"
            value={tab}
            onChange={setTab}
            options={[
              { value: "stock", label: "Stock and pricing" },
              { value: "website", label: "Website" },
            ]}
          />

          {tab === "stock" ? (
            <div className="space-y-5">
              <Field label="Product name" hint={multi ? "The name customers see. Each size below adds its label." : "Shown on the Sell screen and on the website."}>
                <Input value={l.name} autoFocus={isNew} onChange={(e) => rename(e.target.value)} placeholder="e.g. BPC-157" maxLength={120} />
              </Field>
              {nameSize && (
                <div role="alert" className="-mt-2 flex flex-col gap-2 rounded-xl bg-warn/12 px-3.5 py-3 text-sm text-warn sm:flex-row sm:items-center">
                  <span className="flex min-w-0 flex-1 items-start gap-2">
                    <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                    <span>
                      The name includes a size (“{nameSize}”). Sizes are variants, so keep the name to the compound (“{nameWithoutSize(l.name) || "BPC-157"}”) and put “{nameSize}” in the size label.
                    </span>
                  </span>
                  {canMoveSize && (
                    <Button size="sm" className="h-11 shrink-0" onClick={moveSizeToLabel}>
                      Move “{nameSize}” to the size label
                    </Button>
                  )}
                </div>
              )}

              {vs.map((v, i) => {
                const st = ledger.stock.get(v.id);
                return (
                  <fieldset key={v.id} className="rounded-2xl border border-line p-4">
                    <legend className="px-1.5 text-sm font-semibold">{multi ? `Size ${i + 1}${v.variantLabel ? `: ${v.variantLabel}` : ""}` : "Stock and pricing"}</legend>
                    <div className="space-y-4">
                      {(multi || v.variantLabel) && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Size label" hint="For example 5mg or 10mg.">
                            <Input
                              value={v.variantLabel}
                              maxLength={40}
                              onChange={(e) => {
                                const follows = v.name === sellName(v) || !v.name;
                                const next = { ...v, variantLabel: e.target.value };
                                setV(v.id, { variantLabel: e.target.value, ...(follows ? { name: sellName(next) } : {}) });
                              }}
                            />
                          </Field>
                          <Field label="Name on the Sell screen" hint="Also used in sales history.">
                            <Input value={v.name} maxLength={120} onChange={(e) => setV(v.id, { name: e.target.value })} />
                          </Field>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Sell price">
                          <MoneyInput value={v.defaultPriceCents} onChange={(c) => setV(v.id, { defaultPriceCents: c ?? 0 })} />
                        </Field>
                        <Field label="Cost per unit" hint={v.costOverrideCents === null ? `Auto: ${st?.avgCost != null ? fmtMoney(st.avgCost) : "from restocks"}` : "Manual override"}>
                          <MoneyInput nullable placeholder={st?.avgCost != null ? (st.avgCost / 100).toFixed(2) : "auto"} value={v.costOverrideCents} onChange={(c) => setV(v.id, { costOverrideCents: c })} />
                        </Field>
                        <Field label="Low stock warning" hint={`Empty = default (${data.settings.lowStockThreshold})`}>
                          <NumberInput nullable value={v.lowStockThreshold} min={0} placeholder={String(data.settings.lowStockThreshold)} onChange={(n) => setV(v.id, { lowStockThreshold: n })} />
                        </Field>
                        <Field label="Shipping weight" hint="Optional. Empty = default parcel weight.">
                          <NumberInput nullable value={v.weightOz} min={0} step={0.1} suffix="oz" placeholder="default" onChange={(n) => setV(v.id, { weightOz: n })} />
                        </Field>
                      </div>
                      {!v.isNew && (
                        <div className="flex items-center justify-between rounded-xl bg-surface2/70 px-4 py-2.5 text-sm">
                          <span className="text-muted">In stock</span>
                          <span className="font-semibold tabular-nums">{st?.stock ?? 0}</span>
                        </div>
                      )}
                      <Field label="Color on the Sell screen">
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(PRODUCT_COLORS).map(([name, hex]) => (
                            <button
                              key={name}
                              type="button"
                              aria-label={name}
                              aria-pressed={v.color === name}
                              onClick={() => setV(v.id, { color: name })}
                              className={cx("h-9 w-9 rounded-full transition active:scale-90", v.color === name && "ring-2 ring-ink ring-offset-2 ring-offset-surface")}
                              style={{ background: hex }}
                            />
                          ))}
                        </div>
                      </Field>
                      {!v.isNew && <Toggle checked={v.archived} onChange={(x) => setV(v.id, { archived: x })} label="Archived" hint="Hidden from Sell and from the website. History is kept." />}
                      {(multi || !v.isNew) && (
                        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                          {multi && !v.isNew && (
                            <Button size="sm" onClick={() => splitOut(v)}>
                              <Split size={15} /> Split variant out
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-neg" onClick={() => removeVariant(v)}>
                            <Trash2 size={15} /> {v.isNew ? "Remove" : multi ? "Delete size" : "Delete product"}
                          </Button>
                        </div>
                      )}
                    </div>
                  </fieldset>
                );
              })}

              <Button
                variant="soft"
                onClick={() => {
                  // The first size needs a label once there are two.
                  setVs((list) => [...list, newVariant(l.id, l.name, list.length)]);
                }}
              >
                <Plus size={17} /> Add a size
              </Button>
              {!multi && <p className="text-sm text-muted">Selling the same compound in two sizes that already exist as separate products? Use “Combine” on the Inventory page instead.</p>}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-2xl border border-line p-4">
                <Toggle checked={l.showOnWebsite} onChange={(x) => setField("showOnWebsite", x)} label="Show on website" hint="Off = hidden from the store. The product still works on the Sell screen." />
              </div>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold">Photos</h3>
                <PhotoManager photos={l.photos} onChange={(p) => setField("photos", p)} preview={{ name: l.name, priceCents: Math.min(...vs.map((v) => v.defaultPriceCents)) }} />
                <HoverGif value={l.hoverGif} onChange={(f) => setField("hoverGif", f)} />
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold">Description</h3>
                <Field label="Short summary" hint="One or two lines under the name on product cards.">
                  <Textarea value={l.summary} maxLength={300} onChange={(e) => setField("summary", e.target.value)} className="min-h-[64px]" />
                </Field>
                <Field label="Description" hint="Shown on the product page. Leave a blank line between paragraphs.">
                  <Textarea value={l.description} maxLength={6000} onChange={(e) => setField("description", e.target.value)} className="min-h-[140px]" />
                </Field>
                <p className="-mt-2 rounded-lg bg-warn/12 px-3 py-2 text-sm font-medium text-warn">No dosing, health, or results claims.</p>
              </section>

              <section className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">Compound info</h3>
                  <Badge tone="accent">Recommended</Badge>
                  {info && <Badge tone={info.filled === info.total ? "pos" : "warn"}>{info.label}</Badge>}
                </div>
                <p className="-mt-2 text-sm text-muted">Shown as a spec table on the product page. Empty fields are left out, and the whole table is hidden when nothing is filled in.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="CAS number" tag={infoEmpty("casNumber")}>
                    <Input value={l.casNumber} onChange={(e) => setField("casNumber", e.target.value)} placeholder="e.g. 137525-51-0" />
                  </Field>
                  <Field label="Molecular formula" tag={infoEmpty("formula")}>
                    <Input value={l.formula} onChange={(e) => setField("formula", e.target.value)} placeholder="e.g. C62H98N16O22" />
                  </Field>
                  <Field label="Molecular weight" tag={infoEmpty("molecularWeight")}>
                    <Input value={l.molecularWeight} onChange={(e) => setField("molecularWeight", e.target.value)} placeholder="e.g. 1419.5 g/mol" />
                  </Field>
                  <Field label="Purity %" tag={infoEmpty("purity")}>
                    <Input value={l.purity} onChange={(e) => setField("purity", e.target.value)} placeholder="e.g. ≥99%" />
                  </Field>
                  <Field label="Form" tag={infoEmpty("form")}>
                    <Input value={l.form} onChange={(e) => setField("form", e.target.value)} placeholder="e.g. Lyophilized powder" />
                  </Field>
                  <Field label="Storage conditions" tag={infoEmpty("storage")}>
                    <Input value={l.storage} onChange={(e) => setField("storage", e.target.value)} placeholder="e.g. Store at -20°C" />
                  </Field>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold">Testing and COAs</h3>
                {vs.map((v) => (
                  <div key={v.id} className="rounded-2xl border border-line p-4">
                    {multi && <div className="mb-3 text-sm font-semibold">{v.variantLabel || v.name}</div>}
                    <Field label="Testing status" hint={TESTING_HINT[v.testingStatus]}>
                      <Select value={v.testingStatus} onChange={(e) => setV(v.id, { testingStatus: e.target.value as TestingStatus })}>
                        {(Object.keys(TESTING_LABEL) as TestingStatus[]).map((k) => (
                          <option key={k} value={k}>
                            {TESTING_LABEL[k]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {v.isNew ? (
                      <p className="mt-3 text-sm text-muted">Save the product first, then upload COAs for this size.</p>
                    ) : (
                      <CoaManager productId={v.id} coas={data.coas.filter((c) => c.productId === v.id)} onChanged={refresh} />
                    )}
                  </div>
                ))}
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Groups</h3>
                {data.groups.length === 0 ? (
                  <p className="text-sm text-muted">No groups yet. Create them with “Groups” on the Inventory page. They show as Collections on the store.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {data.groups.map((g) => {
                      const on = l.groupIds.includes(g.id);
                      return (
                        <button
                          key={g.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setField("groupIds", on ? l.groupIds.filter((x) => x !== g.id) : [...l.groupIds, g.id])}
                          className={cx("h-10 rounded-xl border px-3.5 text-sm font-medium transition", on ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:text-ink")}
                        >
                          {g.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-muted">A product can be in several groups.</p>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Badges</h3>
                <BadgePicker value={l.badges} onChange={(b) => setField("badges", b)} />
                {data.store.bestSellerMode === "manual" && (
                  <Toggle checked={l.bestSeller} onChange={(x) => setField("bestSeller", x)} label="Show in Best sellers" hint="Best sellers are set to manual in Settings, so you pick them here." />
                )}
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Buy more, save more</h3>
                <Segmented
                  value={deals === null ? "default" : deals.length === 0 ? "off" : "custom"}
                  onChange={(m) => setField("qtyDeals", m === "default" ? null : m === "off" ? [] : storeDeals.length ? storeDeals : [{ minQty: 2, percentOff: 5 }])}
                  options={[
                    { value: "default", label: "Store default" },
                    { value: "custom", label: "Custom" },
                    { value: "off", label: "Off" },
                  ]}
                />
                {deals === null ? (
                  <p className="text-sm text-muted">
                    Uses the store default: {storeDeals.length ? storeDeals.map((d) => `${d.minQty}+ = ${d.percentOff}% off`).join(", ") : "none set"}. Change the default in Promotions.
                  </p>
                ) : deals.length > 0 ? (
                  <QtyDealsEditor value={deals} onChange={(d) => setField("qtyDeals", d)} />
                ) : (
                  <p className="text-sm text-muted">No quantity discount for this product.</p>
                )}
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold">Web address and search engines</h3>
                <Field label="URL slug" hint={`The product page is /product/${l.slug || slugify(l.name)}`}>
                  <Input
                    value={l.slug}
                    placeholder={slugify(l.name)}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setField("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"));
                    }}
                  />
                </Field>
                <Field label="SEO title" hint="Optional. Empty = the product name.">
                  <Input value={l.seoTitle} maxLength={120} onChange={(e) => setField("seoTitle", e.target.value)} />
                </Field>
                <Field label="SEO description" hint="Optional. Empty = the short summary.">
                  <Textarea value={l.seoDescription} maxLength={300} onChange={(e) => setField("seoDescription", e.target.value)} className="min-h-[64px]" />
                </Field>
                {l.showOnWebsite && l.slug && !isNew && (
                  <a href={`/product/${l.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
                    View on the store <ExternalLink size={14} />
                  </a>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Small editors
export function QtyDealsEditor({ value, onChange }: { value: QtyDeal[]; onChange: (d: QtyDeal[]) => void }) {
  return (
    <div className="space-y-2">
      {value.map((d, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-sm text-muted">Buy</span>
          <NumberInput className="w-20" value={d.minQty} min={2} max={1000} onChange={(n) => onChange(value.map((x, k) => (k === i ? { ...x, minQty: n ?? 2 } : x)))} />
          <span className="text-sm text-muted">or more, get</span>
          <NumberInput className="w-24" value={d.percentOff} min={1} max={90} suffix="%" onChange={(n) => onChange(value.map((x, k) => (k === i ? { ...x, percentOff: n ?? 1 } : x)))} />
          <span className="text-sm text-muted">off</span>
          <button type="button" aria-label="Remove tier" onClick={() => onChange(value.filter((_, k) => k !== i))} className="ml-auto flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-neg/10 hover:text-neg">
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      {value.length < 6 && (
        <Button size="sm" onClick={() => onChange([...value, { minQty: (value[value.length - 1]?.minQty ?? 1) + 1, percentOff: Math.min(90, (value[value.length - 1]?.percentOff ?? 0) + 5) }])}>
          <Plus size={15} /> Add a tier
        </Button>
      )}
      <p className="text-xs text-muted">Counts every size of this product in the cart together. Applied as a lower price per vial, and discount codes still work on top.</p>
    </div>
  );
}

function BadgePicker({ value, onChange }: { value: string[]; onChange: (b: string[]) => void }) {
  const [custom, setCustom] = useState("");
  const all = [...new Set([...PRESET_BADGES, ...value])];
  const add = () => {
    const t = custom.trim().slice(0, 24);
    if (t && !value.includes(t) && value.length < 6) onChange([...value, t]);
    setCustom("");
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {all.map((b) => {
          const on = value.includes(b);
          return (
            <button
              key={b}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== b) : [...value, b])}
              className={cx("h-10 rounded-xl border px-3.5 text-sm font-medium transition", on ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:text-ink")}
            >
              {b}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2">
        <Input value={custom} maxLength={24} placeholder="Custom badge" className="h-10 text-sm" onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} />
        <Button size="sm" className="h-10" onClick={add} disabled={!custom.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

function HoverGif({ value, onChange }: { value: string; onChange: (f: string) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line p-3">
      <div className="flex h-16 w-[3.25rem] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface2 text-[10px] text-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {value ? <img src={`/media/${value}`} alt="" className="h-full w-full object-cover" /> : "None"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Hover animation (optional)</div>
        <p className="text-xs text-muted">A GIF that plays when someone hovers the product card. Up to 10 MB.</p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : value ? "Replace" : "Upload"}
        </Button>
        {value && (
          <Button size="sm" variant="ghost" className="text-neg" onClick={() => onChange("")}>
            Remove
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/gif,image/webp"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            const r = await uploadFile(f, "gif");
            if (r.file) onChange(r.file);
          } catch (err) {
            toast.show({ message: (err as Error).message, tone: "error", duration: 7000 });
          }
          setBusy(false);
          if (input.current) input.current.value = "";
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- COAs
function CoaManager({ productId, coas, onChanged }: { productId: string; coas: CoaRec[]; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ lot: "", testDate: "", purity: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const sorted = [...coas].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || (b.testDate ?? b.createdAt).localeCompare(a.testDate ?? a.createdAt));

  async function upload() {
    if (!file) return;
    setBusy(true);
    try {
      await uploadFile(file, "coa", "/api/coas", { productId, lot: form.lot, testDate: form.testDate, purity: form.purity, isCurrent: "true" });
      setFile(null);
      setForm({ lot: "", testDate: "", purity: "" });
      if (input.current) input.current.value = "";
      await onChanged();
      toast.show({ message: "COA uploaded and marked as current.", tone: "success" });
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: "error", duration: 7000 });
    }
    setBusy(false);
  }

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await onChanged();
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: "error" });
    }
  }

  return (
    <div className="mt-4 space-y-3">
      {sorted.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {sorted.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <FileText size={18} className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span>{c.lot ? `Lot ${c.lot}` : "No lot number"}</span>
                  {c.isCurrent && <Badge tone="pos">Current</Badge>}
                </div>
                <div className="text-xs text-muted">
                  {[c.testDate ? `Tested ${fmtDate(c.testDate)}` : "", c.purity ? `${c.purity} purity` : "", c.mime === "application/pdf" ? "PDF" : "Image"].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a href={`/media/${c.file}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-lg px-2.5 text-sm font-medium text-accent hover:bg-surface2">
                  View
                </a>
                {!c.isCurrent && (
                  <Button size="sm" variant="ghost" onClick={() => act(() => api(`/api/coas/${c.id}`, "PATCH", { isCurrent: true }))}>
                    Make current
                  </Button>
                )}
                <button
                  type="button"
                  aria-label="Delete COA"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-neg/10 hover:text-neg"
                  onClick={async () => {
                    if (await confirm({ title: "Delete this COA?", body: "The file is removed from the website.", confirmText: "Delete", danger: true })) act(() => api(`/api/coas/${c.id}`, "DELETE"));
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-xl bg-surface2/60 p-3">
        <div className="mb-2 text-sm font-medium">Upload a COA</div>
        <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-muted file:mr-3 file:h-10 file:rounded-lg file:border file:border-solid file:border-line file:bg-surface file:px-3 file:text-sm file:font-medium file:text-ink" />
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Input className="h-10 text-sm" placeholder="Lot / batch #" value={form.lot} maxLength={60} onChange={(e) => setForm({ ...form, lot: e.target.value })} aria-label="Lot or batch number" />
          <Input className="h-10 text-sm" type="date" value={form.testDate} max={toLocalDateInput(new Date().toISOString())} onChange={(e) => setForm({ ...form, testDate: e.target.value })} aria-label="Test date" />
          <Input className="h-10 text-sm" placeholder="Purity, e.g. 99.5%" value={form.purity} maxLength={40} onChange={(e) => setForm({ ...form, purity: e.target.value })} aria-label="Purity" />
        </div>
        <div className="mt-2 flex items-center gap-3">
          <Button size="sm" variant="primary" disabled={!file || busy} onClick={upload}>
            <Upload size={15} /> {busy ? "Uploading…" : "Upload"}
          </Button>
          <span className="text-xs text-muted">PDF or image, up to 15 MB. The new one becomes the current COA; older batches stay listed.</span>
        </div>
      </div>
    </div>
  );
}
