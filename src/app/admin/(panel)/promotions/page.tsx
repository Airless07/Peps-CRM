"use client";

import { useEffect, useState } from "react";
import { BadgePercent, Gift, Pencil, Plus, Truck, Zap } from "lucide-react";
import { dealText, percentText } from "@/lib/bogo";
import { withSize } from "@/lib/size";
import { QtyDealsEditor } from "@/components/inventory/product-sheet";
import { api, useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Empty, Field, Input, MoneyInput, NumberInput, PageHeader, PageSkeleton, SectionTitle, Segmented, Sheet, Toggle, cx, useConfirm } from "@/components/ui";
import { fmtDate, fmtMoney, fromLocalInput, toLocalDateTimeInput, uid } from "@/lib/format";
import { freeShippingText, isLive, promoCovers, promoHeadlines, promoValueLabel, saleBlock, salePrice, usesLeft } from "@/lib/store/pricing";
import type { AppData, BogoRule, DealItems, PromotionKind, PromotionRec } from "@/lib/types";

const KIND: Record<PromotionKind, { title: string; one: string; icon: typeof Zap; blurb: string }> = {
  code: { title: "Discount codes", one: "discount code", icon: BadgePercent, blurb: "Customers type the code in the cart or at checkout." },
  auto: { title: "Automatic deals", one: "automatic deal", icon: Zap, blurb: "Applied with no code. Can count down, like “$20 off the next 10 orders”, and stop on their own." },
  free_shipping: { title: "Free shipping rules", one: "free shipping rule", icon: Truck, blurb: "Makes the shipping options you pick free, with an optional minimum subtotal and date range." },
  bogo: { title: "BOGO deals", one: "BOGO deal", icon: Gift, blurb: "Buy one, get one free (or a % off). Applied by itself in the website cart and the Sell cart when the items qualify." },
};

const blankBogo = (): BogoRule => ({ buy: { listingIds: [], variantIds: [], qty: 1 }, get: { same: true, listingIds: [], variantIds: [], qty: 1, percentOff: 100 }, online: true, inPerson: true, noCodes: false });

/** Names for deal wording: products by listing, sizes as "GHK-Cu 100mg". */
const dealNames = (data: AppData) => ({
  listing: (id: string) => data.listings.find((l) => l.id === id)?.name,
  variant: (id: string) => {
    const p = data.products.find((x) => x.id === id);
    return p ? withSize(p.name, p.variantLabel) : undefined;
  },
});
/**
 * How an automatic deal shows on the website: "Shows on site as: ~~$55.00~~ $38.50 (30% OFF)" using the
 * cheapest size of the first website product it covers, or "Shows as badge only (has a minimum)".
 */
function SalePreview({ p, data }: { p: PromotionRec; data: AppData }) {
  if (p.kind !== "auto") return null;
  const why = saleBlock(p);
  if (why) return <span data-sale-preview="badge">Shows as badge only ({why})</span>;
  const covered = data.listings.filter((l) => l.showOnWebsite && promoCovers(p, l.id, l.groupIds));
  const price = covered
    .flatMap((l) => data.products.filter((v) => v.listingId === l.id && !v.archived).map((v) => v.defaultPriceCents))
    .sort((a, b) => a - b)[0];
  if (price === undefined) return <span data-sale-preview="none">Shows on site as a sale price (no website product is covered yet)</span>;
  const pct = Math.min(100, p.discountValue);
  return (
    <span data-sale-preview="price">
      Shows on site as: <s>{fmtMoney(price)}</s> <strong className="font-semibold text-ink">{fmtMoney(salePrice(price, { percent: pct }))}</strong> ({pct}% OFF)
    </span>
  );
}

const whereText = (r: BogoRule) => (r.online && r.inPerson ? "Online and in person" : r.online ? "Online only" : "In person only");

const blank = (kind: PromotionKind): PromotionRec => ({
  id: uid(),
  kind,
  name: "",
  code: "",
  discountType: kind === "auto" ? "$" : "%",
  discountValue: kind === "auto" ? 2000 : 10,
  minSubtotalCents: 0,
  startsAt: null,
  endsAt: null,
  maxUses: kind === "auto" ? 10 : null,
  oncePerEmail: false,
  listingIds: [],
  groupIds: [],
  shippingTiers: kind === "free_shipping" ? ["standard"] : [],
  bogo: kind === "bogo" ? blankBogo() : null,
  active: true,
  createdAt: new Date().toISOString(),
  uses: [],
});

function state(p: PromotionRec, now: Date): { label: string; tone: "pos" | "neutral" | "warn" | "neg" } {
  if (!p.active) return { label: "Off", tone: "neutral" };
  if (usesLeft(p) === 0) return { label: "Used up", tone: "neutral" };
  if (p.startsAt && new Date(p.startsAt) > now) return { label: `Starts ${fmtDate(p.startsAt)}`, tone: "warn" };
  if (p.endsAt && new Date(p.endsAt) < now) return { label: "Ended", tone: "neutral" };
  return { label: "Live", tone: "pos" };
}

export default function PromotionsPage() {
  const s = useLoaded();
  const toast = useToast();
  const [edit, setEdit] = useState<{ p: PromotionRec; isNew: boolean } | null>(null);
  const [deals, setDeals] = useState<{ minQty: number; percentOff: number }[] | null>(null);

  useEffect(() => {
    if (s && deals === null) setDeals(s.data.store.qtyDeals);
  }, [s, deals]);

  if (!s || deals === null) return <PageSkeleton />;
  const { data, mutate } = s;
  const now = new Date();
  const bar = data.content.announcement;
  const headlines = promoHeadlines(data.promotions, now, data.store.shippingTiers);
  const tierName = (id: string) => data.store.shippingTiers.find((t) => t.id === id)?.name || id;
  const dealsDirty = JSON.stringify(deals) !== JSON.stringify(data.store.qtyDeals);

  const saveContent = (announcement: typeof bar) => {
    const content = { ...data.content, announcement };
    return mutate((d) => ({ ...d, content }), () => api("/api/settings", "PATCH", { content }));
  };

  const section = (kind: PromotionKind) => {
    const list = data.promotions.filter((p) => p.kind === kind);
    const K = KIND[kind];
    return (
      <div key={kind}>
        <SectionTitle
          right={
            <Button size="sm" variant="soft" className="h-10" onClick={() => setEdit({ p: blank(kind), isNew: true })}>
              <Plus size={16} /> New
            </Button>
          }
        >
          {K.title}
        </SectionTitle>
        {list.length === 0 ? (
          <Card className="flex items-center gap-3 px-4 py-5 text-sm text-muted">
            <K.icon size={20} className="shrink-0" />
            <span>{K.blurb}</span>
          </Card>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {list.map((p) => {
              const st = state(p, now);
              const left = usesLeft(p);
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => setEdit({ p: { ...p }, isNew: false })} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-surface2/60 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cx("font-semibold", kind === "code" && "font-mono tracking-wide")}>{kind === "code" ? p.code : p.name || (kind === "free_shipping" ? "Free shipping" : kind === "bogo" ? dealText(p, dealNames(data)) : "Deal")}</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </div>
                      <div className="mt-0.5 text-sm text-muted">
                        {[
                          kind === "bogo" && p.bogo
                            ? `${p.name ? `${dealText({ name: "", bogo: p.bogo }, dealNames(data))} · ` : ""}${whereText(p.bogo)}${p.bogo.noCodes ? " · no codes" : ""}`
                            : kind === "free_shipping"
                              ? p.shippingTiers.length
                                ? `Free: ${p.shippingTiers.map(tierName).join(", ")}`
                                : "No shipping option picked"
                              : promoValueLabel(p),
                          p.minSubtotalCents > 0 ? `orders ${fmtMoney(p.minSubtotalCents)}+` : "",
                          p.listingIds.length || p.groupIds.length ? "selected products" : "",
                          p.oncePerEmail ? "once per email" : "",
                          p.endsAt ? `until ${fmtDate(p.endsAt)}` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      {kind === "auto" && (
                        <div className="mt-0.5 text-sm text-muted">
                          <SalePreview p={p} data={data} />
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-sm tabular-nums">
                      <div className="font-medium">{p.uses.length} used</div>
                      <div className="text-muted">{left === null ? "no limit" : `${left} left`}</div>
                    </div>
                    <Pencil size={16} className="shrink-0 text-muted" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-3xl pb-10">
      <PageHeader title="Promotions" sub="Discount codes, automatic deals, free shipping and the announcement bar." />

      {(["code", "auto", "free_shipping", "bogo"] as const).map(section)}

      <SectionTitle>Buy more, save more</SectionTitle>
      <Card className="space-y-3 p-4">
        <p className="text-sm text-muted">The store-wide default. It lowers the price per vial when a customer buys several of the same product. A product can use its own tiers or switch this off on its Website tab.</p>
        {deals.length === 0 ? <p className="text-sm font-medium">Off: no quantity discount.</p> : null}
        <QtyDealsEditor value={deals} onChange={setDeals} />
        {dealsDirty && (
          <div className="flex gap-2 border-t border-line pt-3">
            <Button onClick={() => setDeals(data.store.qtyDeals)}>Discard</Button>
            <Button
              variant="primary"
              onClick={async () => {
                const store = { ...data.store, qtyDeals: deals };
                if (await mutate((d) => ({ ...d, store }), () => api("/api/settings", "PATCH", { store }))) toast.show({ message: "Quantity discounts saved", tone: "success" });
              }}
            >
              Save tiers
            </Button>
          </div>
        )}
      </Card>

      <SectionTitle>Announcement bar</SectionTitle>
      <AnnouncementEditor key={JSON.stringify(bar)} value={bar} headlines={headlines} onSave={async (v) => (await saveContent(v)) && toast.show({ message: "Announcement bar saved", tone: "success" })} />

      <PromotionSheet value={edit && edit.p.kind !== "bogo" ? edit : null} onClose={() => setEdit(null)} />
      <BogoSheet value={edit && edit.p.kind === "bogo" ? edit : null} onClose={() => setEdit(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- Announcement bar
type Bar = { mode: "auto" | "custom" | "off"; text: string; code: string; startsAt: string | null; endsAt: string | null };

function AnnouncementEditor({ value, headlines, onSave }: { value: Bar; headlines: { text: string; code: string }[]; onSave: (v: Bar) => void }) {
  const [v, setV] = useState<Bar>(value);
  const dirty = JSON.stringify(v) !== JSON.stringify(value);
  return (
    <Card className="space-y-4 p-4">
      <p className="text-sm text-muted">A slim bar at the top of every store page that stays visible while scrolling.</p>
      <Segmented<Bar["mode"]>
        value={v.mode}
        onChange={(mode) => setV({ ...v, mode })}
        options={[
          { value: "auto", label: "From active promos" },
          { value: "custom", label: "Custom text" },
          { value: "off", label: "Off" },
        ]}
      />
      {v.mode === "auto" && (
        <div className="rounded-xl bg-surface2/70 px-4 py-3 text-sm">
          {headlines.length === 0 ? (
            <span className="text-muted">Nothing is live right now, so the bar is hidden. It appears on its own when a promotion starts.</span>
          ) : (
            <>
              <div className="mb-1 font-medium">Showing now:</div>
              <ul className="space-y-0.5 text-muted">
                {headlines.map((h) => (
                  <li key={h.text + h.code}>
                    {h.text}
                    {h.code && <span className="ml-1 font-mono font-semibold text-ink">{h.code}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {v.mode === "custom" && (
        <>
          <Field label="Text" hint="Keep it short. One line.">
            <Input value={v.text} maxLength={140} placeholder="Free shipping on orders $100+ this weekend" onChange={(e) => setV({ ...v, text: e.target.value })} />
          </Field>
          <Field label="Discount code to show (optional)" hint="Adds a Copy button and an “Apply now” link that puts the code in the cart.">
            <Input value={v.code} maxLength={30} placeholder="SAVE10" className="font-mono uppercase" onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start (optional)">
              <Input type="datetime-local" value={v.startsAt ? toLocalDateTimeInput(v.startsAt) : ""} onChange={(e) => setV({ ...v, startsAt: e.target.value ? fromLocalInput(e.target.value) : null })} />
            </Field>
            <Field label="End (optional)">
              <Input type="datetime-local" value={v.endsAt ? toLocalDateTimeInput(v.endsAt) : ""} onChange={(e) => setV({ ...v, endsAt: e.target.value ? fromLocalInput(e.target.value) : null })} />
            </Field>
          </div>
        </>
      )}
      {dirty && (
        <div className="flex gap-2 border-t border-line pt-3">
          <Button onClick={() => setV(value)}>Discard</Button>
          <Button variant="primary" onClick={() => onSave(v)}>
            Save
          </Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Edit sheet
function PromotionSheet({ value, onClose }: { value: { p: PromotionRec; isNew: boolean } | null; onClose: () => void }) {
  const s = useLoaded();
  const toast = useToast();
  const confirm = useConfirm();
  const [p, setP] = useState<PromotionRec | null>(null);
  const [limited, setLimited] = useState(false);
  useEffect(() => {
    setP(value?.p ?? null);
    setLimited(!!value && (value.p.listingIds.length > 0 || value.p.groupIds.length > 0));
  }, [value]);
  if (!s) return null;
  const { data, mutate } = s;
  const K = p ? KIND[p.kind] : null;
  const set = <T extends keyof PromotionRec>(k: T, v: PromotionRec[T]) => setP((x) => (x ? { ...x, [k]: v } : x));

  async function save() {
    if (!p || !value) return;
    const { uses: _u, createdAt: _c, ...rest } = p;
    if (p.kind === "free_shipping" && p.shippingTiers.length === 0) return toast.show({ message: "Pick at least one shipping option this rule makes free.", tone: "error" });
    const body = { ...rest, listingIds: limited ? p.listingIds : [], groupIds: limited ? p.groupIds : [] };
    try {
      await api("/api/promotions", value.isNew ? "POST" : "PUT", body);
      await s!.refresh();
      toast.show({ message: `${K!.one[0].toUpperCase()}${K!.one.slice(1)} saved`, tone: "success" });
      onClose();
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: "error", duration: 7000 });
    }
  }

  async function remove() {
    if (!p) return;
    if (!(await confirm({ title: `Delete this ${K!.one}?`, body: "Orders that already used it keep their discount. To pause it instead, turn it off.", confirmText: "Delete", danger: true }))) return;
    onClose();
    await mutate((d) => ({ ...d, promotions: d.promotions.filter((x) => x.id !== p.id) }), () => api("/api/promotions", "DELETE", { id: p.id }));
  }

  const toggleIn = (key: "listingIds" | "groupIds", id: string) => p && set(key, p[key].includes(id) ? p[key].filter((x) => x !== id) : [...p[key], id]);

  return (
    <Sheet
      open={!!value}
      onClose={onClose}
      wide
      title={value && K ? `${value.isNew ? "New" : "Edit"} ${K.one}` : ""}
      footer={
        <div className="flex gap-2">
          {value && !value.isNew && (
            <Button variant="ghost" className="text-neg" onClick={remove}>
              Delete
            </Button>
          )}
          <Button block onClick={onClose}>
            Cancel
          </Button>
          <Button block variant="primary" onClick={save}>
            Save
          </Button>
        </div>
      }
    >
      {p && K && (
        <div className="space-y-5">
          <p className="text-sm text-muted">{K.blurb}</p>
          {p.kind === "code" ? (
            <Field label="Code" hint="What the customer types. Letters and numbers, no spaces.">
              <Input value={p.code} maxLength={30} autoFocus={value?.isNew} placeholder="SAVE10" className="font-mono uppercase tracking-wide" onChange={(e) => set("code", e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} />
            </Field>
          ) : (
            <Field label="Name" hint={p.kind === "auto" ? "Shown to the customer next to the discount, for example “Launch deal”." : "For you, in this list. Customers see exactly what is free instead, for example “Free standard shipping on orders $100+”."}>
              <Input value={p.name} maxLength={80} autoFocus={value?.isNew} onChange={(e) => set("name", e.target.value)} />
            </Field>
          )}

          {p.kind === "free_shipping" && (
            <fieldset data-free-tiers>
              <legend className="mb-1.5 text-sm font-medium text-muted">Makes these shipping options free</legend>
              <div className="space-y-2">
                {data.store.shippingTiers.map((t) => {
                  const on = p.shippingTiers.includes(t.id);
                  return (
                    <label key={t.id} className={cx("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition", on ? "border-accent bg-accent/5" : "border-line")}>
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-[rgb(var(--accent))]"
                        checked={on}
                        onChange={(e) => set("shippingTiers", e.target.checked ? (["standard", "priority", "express"] as const).filter((x) => x === t.id || p.shippingTiers.includes(x)) : p.shippingTiers.filter((x) => x !== t.id))}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{t.name}</span>
                        <span className="block text-xs text-muted">{t.enabled ? `${fmtMoney(t.flatCents)} flat price` : "Not offered right now (Settings, Shipping)"}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className={cx("mt-1.5 text-xs", p.shippingTiers.length === 0 ? "font-medium text-neg" : "text-muted")}>
                {p.shippingTiers.length === 0 ? "Pick at least one." : `Customers see: “${freeShippingText(p.shippingTiers, data.store.shippingTiers)}${p.minSubtotalCents > 0 ? ` on orders ${fmtMoney(p.minSubtotalCents).replace(/\.00$/, "")}+` : ""}”. Other options are charged as usual.`}
              </p>
            </fieldset>
          )}

          {p.kind !== "free_shipping" && (
            <Field label="Discount">
              <div className="flex gap-2">
                <Segmented
                  className="shrink-0"
                  value={p.discountType}
                  onChange={(t) => setP({ ...p, discountType: t, discountValue: t === "%" ? Math.min(100, p.discountType === "%" ? p.discountValue : 10) : p.discountType === "$" ? p.discountValue : 1000 })}
                  options={[
                    { value: "$", label: "$ off" },
                    { value: "%", label: "% off" },
                  ]}
                />
                {p.discountType === "$" ? (
                  <MoneyInput className="flex-1" value={p.discountValue} onChange={(c) => set("discountValue", c ?? 0)} />
                ) : (
                  <NumberInput className="flex-1" value={p.discountValue} min={0} max={100} step={0.5} suffix="%" onChange={(n) => set("discountValue", n ?? 0)} />
                )}
              </div>
            </Field>
          )}

          <Field label="Minimum subtotal (optional)" hint="The cart must reach this amount, after quantity savings. Empty = no minimum.">
            <MoneyInput value={p.minSubtotalCents} onChange={(c) => set("minSubtotalCents", c ?? 0)} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts (optional)" hint="Empty = right away.">
              <Input type="datetime-local" value={p.startsAt ? toLocalDateTimeInput(p.startsAt) : ""} onChange={(e) => set("startsAt", e.target.value ? fromLocalInput(e.target.value) : null)} />
            </Field>
            <Field label="Ends (optional)" hint="Empty = no end date.">
              <Input type="datetime-local" value={p.endsAt ? toLocalDateTimeInput(p.endsAt) : ""} onChange={(e) => set("endsAt", e.target.value ? fromLocalInput(e.target.value) : null)} />
            </Field>
          </div>

          {p.kind !== "free_shipping" && (
            <Field
              label={p.kind === "auto" ? "Stop after this many orders" : "Total use limit (optional)"}
              hint={`${p.uses.length} used so far${usesLeft(p) !== null ? `, ${usesLeft(p)} left` : ""}. Canceled orders don’t count. Empty = no limit.`}
            >
              <NumberInput nullable className="w-48" value={p.maxUses} min={1} placeholder="no limit" onChange={(n) => set("maxUses", n)} />
            </Field>
          )}

          {p.kind === "code" && <Toggle checked={p.oncePerEmail} onChange={(v) => set("oncePerEmail", v)} label="One use per email" hint="Each customer can use the code once." />}

          {p.kind === "auto" && (
            <div className="space-y-2">
              <Toggle
                checked={p.showSalePrice !== false}
                onChange={(v) => set("showSalePrice", v)}
                label="Show sale price on products"
                hint="Percent off with no minimum and no order limit: products show the regular price crossed out next to the sale price, and checkout charges exactly that. Other deals show as a badge and come off the order at checkout."
              />
              <p className="rounded-xl bg-surface2 px-3 py-2 text-sm text-muted" data-sale-preview-box>
                <SalePreview p={p} data={data} />
              </p>
            </div>
          )}

          {p.kind !== "free_shipping" && (
            <div className="space-y-3">
              <Toggle checked={limited} onChange={setLimited} label="Limit to certain products or groups" hint="Off = applies to the whole cart." />
              {limited && (
                <div className="space-y-3 rounded-2xl border border-line p-3">
                  {data.groups.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Groups</div>
                      <div className="flex flex-wrap gap-2">
                        {data.groups.map((g) => (
                          <button key={g.id} type="button" aria-pressed={p.groupIds.includes(g.id)} onClick={() => toggleIn("groupIds", g.id)} className={cx("h-10 rounded-xl border px-3 text-sm font-medium", p.groupIds.includes(g.id) ? "border-accent bg-accent/10 text-accent" : "border-line text-muted")}>
                            {g.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Products</div>
                    <div className="flex flex-wrap gap-2">
                      {data.listings.map((l) => (
                        <button key={l.id} type="button" aria-pressed={p.listingIds.includes(l.id)} onClick={() => toggleIn("listingIds", l.id)} className={cx("h-10 rounded-xl border px-3 text-sm font-medium", p.listingIds.includes(l.id) ? "border-accent bg-accent/10 text-accent" : "border-line text-muted")}>
                          {l.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <Toggle checked={p.active} onChange={(v) => set("active", v)} label="Active" hint="Turn off to pause it without deleting." />
          {isLive(p, new Date()) && usesLeft(p) !== 0 && <p className="rounded-xl bg-pos/10 px-4 py-2.5 text-sm text-pos">This will be live as soon as you save.</p>}
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- BOGO deal sheet
function BogoSheet({ value, onClose }: { value: { p: PromotionRec; isNew: boolean } | null; onClose: () => void }) {
  const s = useLoaded();
  const toast = useToast();
  const confirm = useConfirm();
  const [p, setP] = useState<PromotionRec | null>(null);
  useEffect(() => setP(value ? { ...value.p, bogo: value.p.bogo ?? blankBogo() } : null), [value]);
  if (!s) return null;
  const { data, mutate } = s;
  const r = p?.bogo ?? null;
  const set = <T extends keyof PromotionRec>(k: T, v: PromotionRec[T]) => setP((x) => (x ? { ...x, [k]: v } : x));
  const setRule = (patch: Partial<BogoRule>) => setP((x) => (x && x.bogo ? { ...x, bogo: { ...x.bogo, ...patch } } : x));
  const names = dealNames(data);

  async function save() {
    if (!p || !value || !r) return;
    const { uses: _u, createdAt: _c, ...rest } = p;
    try {
      await api("/api/promotions", value.isNew ? "POST" : "PUT", { ...rest, listingIds: [], groupIds: [], shippingTiers: [], discountType: "%", discountValue: r.get.percentOff });
      await s!.refresh();
      toast.show({ message: "BOGO deal saved", tone: "success" });
      onClose();
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: "error", duration: 7000 });
    }
  }

  async function remove() {
    if (!p) return;
    if (!(await confirm({ title: "Delete this BOGO deal?", body: "Orders that already got it keep their prices. To pause it instead, turn it off.", confirmText: "Delete", danger: true }))) return;
    onClose();
    await mutate((d) => ({ ...d, promotions: d.promotions.filter((x) => x.id !== p.id) }), () => api("/api/promotions", "DELETE", { id: p.id }));
  }

  const preview = p && r ? dealText({ name: "", bogo: r }, names) : "";
  const where = r ? (r.online && r.inPerson ? "both" : r.online ? "online" : "inperson") : "both";
  const left = p ? usesLeft(p) : null;

  return (
    <Sheet
      open={!!value}
      onClose={onClose}
      wide
      title={value ? `${value.isNew ? "New" : "Edit"} BOGO deal` : ""}
      footer={
        <div className="flex gap-2">
          {value && !value.isNew && (
            <Button variant="ghost" className="text-neg" onClick={remove}>
              Delete
            </Button>
          )}
          <Button block onClick={onClose}>
            Cancel
          </Button>
          <Button block variant="primary" onClick={save}>
            Save
          </Button>
        </div>
      }
    >
      {p && r && (
        <div className="space-y-5" data-bogo-sheet>
          <p className="text-sm text-muted">{KIND.bogo.blurb} The free (or discounted) item still counts its cost and leaves stock, so profit stays right.</p>
          <Field label="Name" hint={`Shown to customers on the product, in the cart and in the promo bar. For example: ${preview || "Buy 1 GHK-Cu, get 1 free"}.`}>
            <Input value={p.name} maxLength={80} autoFocus={value?.isNew} placeholder={preview} onChange={(e) => set("name", e.target.value)} />
          </Field>

          <fieldset className="space-y-3 rounded-2xl border border-line p-3.5" data-bogo-buy>
            <legend className="px-1 text-sm font-semibold">Buy</legend>
            <Field label="How many">
              <NumberInput className="w-40" label="buy quantity" value={r.buy.qty} min={1} max={99} onChange={(n) => setRule({ buy: { ...r.buy, qty: Math.max(1, n ?? 1) } })} />
            </Field>
            <ItemPicker data={data} value={r.buy} onChange={(v) => setRule({ buy: { ...r.buy, ...v } })} />
          </fieldset>

          <fieldset className="space-y-3 rounded-2xl border border-line p-3.5" data-bogo-get>
            <legend className="px-1 text-sm font-semibold">Get</legend>
            <Segmented<"same" | "other">
              value={r.get.same ? "same" : "other"}
              onChange={(v) => setRule({ get: { ...r.get, same: v === "same" } })}
              options={[
                { value: "same", label: "The same item" },
                { value: "other", label: "A different item" },
              ]}
            />
            {!r.get.same && <ItemPicker data={data} value={r.get} onChange={(v) => setRule({ get: { ...r.get, ...v } })} />}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="How many">
                <NumberInput className="w-40" label="get quantity" value={r.get.qty} min={1} max={99} onChange={(n) => setRule({ get: { ...r.get, qty: Math.max(1, n ?? 1) } })} />
              </Field>
              <Field label="Discount on it">
                <div className="flex flex-wrap gap-2">
                  <Segmented<"free" | "pct">
                    className="w-44"
                    value={r.get.percentOff >= 100 ? "free" : "pct"}
                    onChange={(v) => setRule({ get: { ...r.get, percentOff: v === "free" ? 100 : 50 } })}
                    options={[
                      { value: "free", label: "Free" },
                      { value: "pct", label: "% off" },
                    ]}
                  />
                  {r.get.percentOff < 100 && <NumberInput className="w-36" label="percent off" value={r.get.percentOff} min={1} max={99} suffix="%" onChange={(n) => setRule({ get: { ...r.get, percentOff: Math.max(1, Math.min(99, n ?? 50)) } })} />}
                </div>
              </Field>
            </div>
            <p className="text-xs text-muted">
              For every {r.buy.qty} bought, the customer gets {r.get.qty} {r.get.same ? "of the same item" : "of the item picked here"} {percentText(r.get.percentOff)}.
            </p>
          </fieldset>

          <Field label="Where it applies">
            <Segmented<"both" | "online" | "inperson">
              value={where}
              onChange={(v) => setRule({ online: v !== "inperson", inPerson: v !== "online" })}
              options={[
                { value: "online", label: "Online" },
                { value: "inperson", label: "In person" },
                { value: "both", label: "Both" },
              ]}
            />
          </Field>

          <Toggle checked={r.noCodes} onChange={(v) => setRule({ noCodes: v })} label="No codes with this deal" hint="When the deal applies, discount codes can't be used on the same order. Off = codes stack on top." />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts (optional)" hint="Empty = right away.">
              <Input type="datetime-local" value={p.startsAt ? toLocalDateTimeInput(p.startsAt) : ""} onChange={(e) => set("startsAt", e.target.value ? fromLocalInput(e.target.value) : null)} />
            </Field>
            <Field label="Ends (optional)" hint="Empty = no end date.">
              <Input type="datetime-local" value={p.endsAt ? toLocalDateTimeInput(p.endsAt) : ""} onChange={(e) => set("endsAt", e.target.value ? fromLocalInput(e.target.value) : null)} />
            </Field>
          </div>
          <Field label="Total use limit (optional)" hint={`${p.uses.length} used so far${left !== null ? `, ${left} left` : ""}. Each order that gets the deal is one use. Empty = no limit.`}>
            <NumberInput nullable className="w-48" value={p.maxUses} min={1} placeholder="no limit" onChange={(n) => set("maxUses", n)} />
          </Field>
          <p className="text-xs text-muted">Buy more, save more never applies to the same units as this deal. On the website the cart uses whichever gives the customer the better price.</p>
          <Toggle checked={p.active} onChange={(v) => set("active", v)} label="Active" hint="Turn off to pause it without deleting." />
          {isLive(p, new Date()) && usesLeft(p) !== 0 && <p className="rounded-xl bg-pos/10 px-4 py-2.5 text-sm text-pos">This will be live as soon as you save.</p>}
        </div>
      )}
    </Sheet>
  );
}

/** Pick whole products (every size) or single sizes. */
function ItemPicker({ data, value, onChange }: { data: AppData; value: DealItems; onChange: (v: DealItems) => void }) {
  const toggle = (key: "listingIds" | "variantIds", id: string) => onChange({ ...value, [key]: value[key].includes(id) ? value[key].filter((x) => x !== id) : [...value[key], id] });
  const listings = data.listings.filter((l) => data.products.some((p) => p.listingId === l.id && !p.archived));
  const btn = (on: boolean) => cx("min-h-10 rounded-xl border px-3 text-sm font-medium transition", on ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:bg-surface2");
  return (
    <div className="space-y-2.5">
      {listings.length === 0 && <p className="text-sm text-muted">Add products in Inventory first.</p>}
      {listings.map((l) => {
        const sizes = data.products.filter((p) => p.listingId === l.id && !p.archived);
        const whole = value.listingIds.includes(l.id);
        return (
          <div key={l.id} className="flex flex-wrap items-center gap-1.5" data-pick-product={l.name}>
            <button type="button" aria-pressed={whole} className={btn(whole)} onClick={() => toggle("listingIds", l.id)}>
              {l.name}
              {sizes.length > 1 ? " (any size)" : ""}
            </button>
            {sizes.length > 1 &&
              !whole &&
              sizes.map((v) => (
                <button key={v.id} type="button" aria-pressed={value.variantIds.includes(v.id)} className={btn(value.variantIds.includes(v.id))} onClick={() => toggle("variantIds", v.id)}>
                  {v.variantLabel || v.name}
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}
