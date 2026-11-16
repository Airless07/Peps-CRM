"use client";

import { useEffect, useState } from "react";
import { BadgePercent, Pencil, Plus, Truck, Zap } from "lucide-react";
import { QtyDealsEditor } from "@/components/inventory/product-sheet";
import { api, useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Empty, Field, Input, MoneyInput, NumberInput, PageHeader, PageSkeleton, SectionTitle, Segmented, Sheet, Toggle, cx, useConfirm } from "@/components/ui";
import { fmtDate, fmtMoney, fromLocalInput, toLocalDateTimeInput, uid } from "@/lib/format";
import { isLive, promoHeadlines, promoValueLabel, usesLeft } from "@/lib/store/pricing";
import type { PromotionKind, PromotionRec } from "@/lib/types";

const KIND: Record<PromotionKind, { title: string; one: string; icon: typeof Zap; blurb: string }> = {
  code: { title: "Discount codes", one: "discount code", icon: BadgePercent, blurb: "Customers type the code in the cart or at checkout." },
  auto: { title: "Automatic deals", one: "automatic deal", icon: Zap, blurb: "Applied with no code. Can count down, like “$20 off the next 10 orders”, and stop on their own." },
  free_shipping: { title: "Free shipping rules", one: "free shipping rule", icon: Truck, blurb: "Free shipping during a date range, with an optional minimum subtotal." },
};

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
  const headlines = promoHeadlines(data.promotions, now);
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
                        <span className={cx("font-semibold", kind === "code" && "font-mono tracking-wide")}>{kind === "code" ? p.code : p.name || (kind === "free_shipping" ? "Free shipping" : "Deal")}</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </div>
                      <div className="mt-0.5 text-sm text-muted">
                        {[
                          kind === "free_shipping" ? "Free shipping" : promoValueLabel(p),
                          p.minSubtotalCents > 0 ? `orders ${fmtMoney(p.minSubtotalCents)}+` : "",
                          p.listingIds.length || p.groupIds.length ? "selected products" : "",
                          p.oncePerEmail ? "once per email" : "",
                          p.endsAt ? `until ${fmtDate(p.endsAt)}` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
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

      {(["code", "auto", "free_shipping"] as const).map(section)}

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

      <PromotionSheet value={edit} onClose={() => setEdit(null)} />
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
            <Field label="Name" hint={p.kind === "auto" ? "Shown to the customer next to the discount, for example “Launch deal”." : "Shown in the cart and the announcement bar, for example “Free shipping weekend”."}>
              <Input value={p.name} maxLength={80} autoFocus={value?.isNew} onChange={(e) => set("name", e.target.value)} />
            </Field>
          )}

          {p.kind !== "free_shipping" && (
            <Field label="Discount">
              <div className="flex gap-2">
                <Segmented
                  className="w-32 shrink-0"
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
              <NumberInput nullable className="w-40" value={p.maxUses} min={1} placeholder="no limit" onChange={(n) => set("maxUses", n)} />
            </Field>
          )}

          {p.kind === "code" && <Toggle checked={p.oncePerEmail} onChange={(v) => set("oncePerEmail", v)} label="One use per email" hint="Each customer can use the code once." />}

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
