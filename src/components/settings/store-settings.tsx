"use client";

// Store settings: one form (the whole StoreSettings object), shown in tabs, saved together.
import { useEffect, useState } from "react";
import { AlertTriangle, CircleCheck, Circle, Copy, Download, Plus, X } from "lucide-react";
import Link from "next/link";
import { SingleImage } from "@/components/inventory/media";
import { api, useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Field, Input, MoneyInput, NumberInput, SectionTitle, Segmented, Select, Textarea, Toggle, cx, useConfirm } from "@/components/ui";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { DEFAULT_ACCENT, paymentInfoSet, POLICY_IDS, shipFromSet, TIER_SERVICE, type StoreSettings } from "@/lib/store/config";
import { PAY_METHODS, paymentWarnings } from "@/lib/store/payments";
import { listingsMissingInfo, listingsWithNoInfo } from "@/lib/store/product-info";
import { STATES } from "@/lib/store/schemas";
import { RECOMMENDED_SIZES } from "@/lib/store/sizes";

export type StoreTab = "launch" | "store" | "payments" | "shipping" | "email" | "referrals" | "local" | "backups";

interface Keys {
  resend: boolean;
  shippo: boolean;
  shippoTest: boolean;
  webhookPath: string;
}

export function StoreSettingsTabs({ tab, onTab }: { tab: StoreTab; onTab: (t: string) => void }) {
  const s = useLoaded();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<StoreSettings | null>(null);
  const [keys, setKeys] = useState<Keys | null>(null);
  const [test, setTest] = useState<{ email?: { ok: boolean; message: string }; shippo?: { ok: boolean; message: string } }>({});
  const [testing, setTesting] = useState<"email" | "shippo" | null>(null);
  const [testTo, setTestTo] = useState("");
  const [newEmail, setNewEmail] = useState("");

  useEffect(() => {
    if (s && !form) setForm(s.data.store);
  }, [s, form]);
  useEffect(() => {
    api<Keys>("/api/settings/test").then(setKeys).catch(() => {});
  }, []);

  if (!s || !form) return null;
  const { data, mutate } = s;
  const dirty = JSON.stringify(form) !== JSON.stringify(data.store);
  const set = <K extends keyof StoreSettings>(k: K, v: StoreSettings[K]) => setForm({ ...form, [k]: v });
  const from = form.shipFrom;
  const setFrom = (k: keyof StoreSettings["shipFrom"], v: string) => set("shipFrom", { ...from, [k]: v });

  async function save(next = form!) {
    const ok = await mutate((d) => ({ ...d, store: next }), () => api("/api/settings", "PATCH", { store: next }));
    if (ok) toast.show({ message: "Settings saved", tone: "success" });
    return ok;
  }

  async function runTest(what: "email" | "shippo") {
    setTesting(what);
    try {
      const r = await api<{ ok: boolean; message: string }>("/api/settings/test", "POST", what === "email" ? { what, to: testTo } : { what });
      setTest((t) => ({ ...t, [what]: r }));
      try {
        localStorage.setItem(`peps-test-${what}`, r.ok ? "ok" : "");
      } catch {}
    } catch (e) {
      setTest((t) => ({ ...t, [what]: { ok: false, message: (e as Error).message } }));
    }
    setTesting(null);
  }

  const result = (r?: { ok: boolean; message: string }) =>
    r && (
      <div role="status" className={cx("mt-3 flex gap-2.5 rounded-xl px-4 py-3 text-sm", r.ok ? "bg-pos/10 text-pos" : "bg-neg/10 text-neg")}>
        {r.ok ? <CircleCheck size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
        <span>{r.message}</span>
      </div>
    );

  const keyWarning = (ok: boolean | undefined, name: string, what: string) =>
    ok === false && (
      <div className="mb-3 flex gap-2.5 rounded-xl bg-warn/12 px-4 py-3 text-sm text-warn">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        <span>
          <strong>{name} is not set.</strong> {what} Add it to the environment variables (on Railway: your service, then Variables) and redeploy.
        </span>
      </div>
    );

  const saveBar = dirty && (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-30 animate-toast-in px-3 md:bottom-6 md:left-64 md:px-8">
      <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border border-line bg-surface p-2 shadow-xl">
        <span className="flex-1 px-3 text-sm text-muted">Unsaved changes</span>
        <Button variant="ghost" onClick={() => setForm(data.store)}>
          Discard
        </Button>
        <Button variant="primary" onClick={() => save()}>
          Save
        </Button>
      </div>
    </div>
  );

  // ------------------------------------------------------------ Launch checklist
  if (tab === "launch") {
    const onSite = data.listings.filter((l) => l.showOnWebsite);
    const variantsOnSite = data.products.filter((p) => !p.archived && onSite.some((l) => l.id === p.listingId));
    const withCoa = variantsOnSite.filter((v) => data.coas.some((c) => c.productId === v.id)).length;
    const reviewed = POLICY_IDS.filter((id) => data.content.policies[id].reviewed).length;
    const noInfo = listingsWithNoInfo(onSite);
    const partInfo = listingsMissingInfo(onSite);
    let emailOk = false;
    let shippoOk = false;
    try {
      emailOk = !!keys?.resend && (test.email?.ok ?? localStorage.getItem("peps-test-email") === "ok");
      shippoOk = !!keys?.shippo && (test.shippo?.ok ?? localStorage.getItem("peps-test-shippo") === "ok");
    } catch {}
    const needShippo = data.store.shippingMode === "live";
    const items: { done: boolean; title: string; detail: string; href: string; optional?: boolean }[] = [
      { done: onSite.length > 0, title: "Products on the website", detail: onSite.length ? `${onSite.length} of ${data.listings.length} products are switched on.` : "Open a product, go to the Website tab and turn on “Show on website”.", href: "/admin/inventory" },
      { done: onSite.length > 0 && onSite.every((l) => l.photos.length > 0), title: "Photos added", detail: onSite.length === 0 ? "Add products to the website first." : `${onSite.filter((l) => l.photos.length > 0).length} of ${onSite.length} website products have a photo.`, href: "/admin/inventory" },
      { done: variantsOnSite.length > 0 && withCoa === variantsOnSite.length, title: "COAs uploaded", detail: variantsOnSite.length === 0 ? "Add products to the website first." : `${withCoa} of ${variantsOnSite.length} sizes have a COA. Sizes without one show their testing status instead.`, href: "/admin/inventory", optional: true },
      { done: paymentInfoSet(data.store), title: "Payment info set", detail: paymentInfoSet(data.store) ? "At least one payment method is on and has its details." : "Turn on a payment method and enter where customers send money.", href: "/admin/settings?tab=payments" },
      { done: shipFromSet(data.store), title: "Ship-from address set", detail: "Used on labels and packing slips.", href: "/admin/settings?tab=shipping" },
      { done: emailOk, title: "Email working", detail: keys?.resend ? "Send a test email to confirm." : "RESEND_API_KEY is not set yet.", href: "/admin/settings?tab=email" },
      { done: shippoOk, title: "Shippo working", detail: keys?.shippo ? "Run “Test Shippo connection” to confirm." : needShippo ? "SHIPPO_API_KEY is not set yet." : "Optional with flat-rate shipping. Needed to buy labels in the admin.", href: "/admin/settings?tab=shipping", optional: !needShippo },
      { done: onSite.length > 0 && noInfo.length === 0, title: "Products with no website info", detail: onSite.length === 0 ? "Add products to the website first." : noInfo.length === 0 ? `Every website product has compound info (${partInfo.length ? `${partInfo.length} still have empty fields` : "all complete"}).` : `${noInfo.length} of ${onSite.length} website products have no compound info at all (CAS, formula, weight, purity, form, storage): ${noInfo.slice(0, 4).map((l) => l.name).join(", ")}${noInfo.length > 4 ? "…" : ""}. Their product pages show no spec table.`, href: "/admin/inventory", optional: true },
      { done: reviewed === POLICY_IDS.length, title: "Policies reviewed", detail: `${reviewed} of ${POLICY_IDS.length} policy pages are marked as reviewed.`, href: "/admin/content?tab=policies" },
    ];
    const required = items.filter((i) => !i.optional);
    const ready = required.every((i) => i.done);
    return (
      <div className="pb-10">
        <Card className={cx("mb-5 p-5", data.store.open ? "border-pos/40" : "")}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="text-lg font-semibold">The store is {data.store.open ? "open" : "closed"}</span>
                <Badge tone={data.store.open ? "pos" : "neutral"}>{data.store.open ? "Open" : "Coming soon"}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted">
                {data.store.open ? "Anyone can browse and place orders." : "Visitors see a “Coming soon” page. While signed in here, you can still preview the whole store."}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <a href="/" target="_blank" rel="noreferrer">
                <Button>{data.store.open ? "View store" : "Preview store"}</Button>
              </a>
              {data.store.open ? (
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (await confirm({ title: "Close the store?", body: "Visitors will see “Coming soon” and can’t place orders. Existing orders are not affected.", confirmText: "Close the store", danger: true })) {
                      const next = { ...data.store, open: false };
                      setForm(next);
                      save(next);
                    }
                  }}
                >
                  Close the store
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={async () => {
                    const ok = await confirm({
                      title: ready ? "Open the store?" : "Open the store anyway?",
                      body: ready ? "The store becomes visible to everyone and customers can place orders." : `Not everything on the checklist is done: ${required.filter((i) => !i.done).map((i) => i.title.toLowerCase()).join(", ")}. You can still open the store.`,
                      confirmText: "Open the store",
                    });
                    if (ok) {
                      const next = { ...data.store, open: true };
                      setForm(next);
                      save(next);
                    }
                  }}
                >
                  Open the store
                </Button>
              )}
            </div>
          </div>
        </Card>

        <SectionTitle>Launch checklist</SectionTitle>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {items.map((i) => (
            <li key={i.title}>
              <Link href={i.href} onClick={() => onTab(new URL(i.href, "http://x").searchParams.get("tab") ?? "launch")} className="flex items-start gap-3 px-4 py-3.5 transition hover:bg-surface2/60 sm:px-5">
                {i.done ? <CircleCheck size={22} className="mt-0.5 shrink-0 text-pos" /> : <Circle size={22} className="mt-0.5 shrink-0 text-line" />}
                <span className="min-w-0 flex-1">
                  <span className={cx("block font-medium", i.done && "text-muted line-through decoration-line")}>
                    {i.title}
                    {i.optional && <span className="ml-2 text-xs font-normal text-muted no-underline">optional</span>}
                  </span>
                  <span className="block text-sm text-muted">{i.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">The list checks itself off as you set things up.</p>
      </div>
    );
  }

  // ------------------------------------------------------------ Store
  if (tab === "store") {
    return (
      <div className="pb-24">
        <SectionTitle>Store</SectionTitle>
        <Card className="space-y-5 p-4">
          <Field label="Store name" hint="Shown in the header, emails and page titles.">
            <Input value={form.storeName} maxLength={60} onChange={(e) => set("storeName", e.target.value)} />
          </Field>
          <div>
            <div className="mb-1.5 text-sm font-medium text-muted">Logo</div>
            <SingleImage value={form.logo} onChange={(id) => set("logo", id)} kind="logo" hint={`${RECOMMENDED_SIZES.logo} Until you upload one, the store shows the name as a text wordmark.`} />
          </div>
          <div>
            <div className="mb-1.5 text-sm font-medium text-muted">Favicon (browser tab icon)</div>
            <SingleImage value={form.favicon} onChange={(id) => set("favicon", id)} kind="favicon" shape="square" hint="Square image, at least 256 × 256 px. Empty = the default vial icon." />
          </div>
          <Field label="Accent color" hint="Used for buttons, links and badges on the store. Keep it dark enough for white text.">
            <div className="flex items-center gap-3">
              <input type="color" value={form.accentColor} onChange={(e) => set("accentColor", e.target.value)} aria-label="Accent color" className="h-12 w-16 cursor-pointer rounded-xl border border-line bg-bg p-1" />
              <Input value={form.accentColor} maxLength={7} onChange={(e) => set("accentColor", e.target.value)} className="w-32 font-mono" />
              {form.accentColor.toLowerCase() !== DEFAULT_ACCENT && (
                <Button size="sm" variant="ghost" onClick={() => set("accentColor", DEFAULT_ACCENT)}>
                  Reset to deep red
                </Button>
              )}
            </div>
          </Field>
          <Field label="Website address" hint="Used for links in emails. Leave empty to use the address the site is opened on.">
            <Input value={form.siteUrl} placeholder="https://buckshotlabs.com" onChange={(e) => set("siteUrl", e.target.value)} inputMode="url" />
          </Field>
        </Card>

        <SectionTitle>Orders</SectionTitle>
        <Card className="space-y-5 p-4">
          <Field label="Cancel unpaid orders after" hint="An order that is not marked paid in this time is canceled automatically, and the customer is emailed.">
            <NumberInput className="w-44" value={form.autoCancelHours} min={1} max={720} suffix="hrs" onChange={(n) => set("autoCancelHours", n ?? 24)} />
          </Field>
          <Field label="Best sellers" hint="Automatic picks the top products by units sold in the last 30 days. Manual lets you pick them on each product’s Website tab.">
            <Segmented
              className="max-w-xs"
              value={form.bestSellerMode}
              onChange={(v) => set("bestSellerMode", v)}
              options={[
                { value: "auto", label: "Automatic" },
                { value: "manual", label: "Manual" },
              ]}
            />
          </Field>
        </Card>
        {saveBar}
      </div>
    );
  }

  // ------------------------------------------------------------ Payments
  if (tab === "payments") {
    const p = form.payments;
    const warnings = paymentWarnings(p);
    return (
      <div className="pb-24">
        {warnings.length > 0 && (
          <div className="mb-4 space-y-2">
            {warnings.map((w) => (
              <div key={w} className="flex gap-2.5 rounded-xl bg-warn/12 px-4 py-3 text-sm text-warn">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
        <SectionTitle>Payment methods at checkout</SectionTitle>
        <div className="space-y-3">
          {PAY_METHODS.map((m) => {
            if (m.kind === "manual") {
              const id = m.id as "zelle" | "cashapp" | "venmo";
              const v = p[id];
              return (
                <Card key={m.id} className="space-y-3 p-4">
                  <Toggle checked={v.enabled} onChange={(x) => set("payments", { ...p, [id]: { ...v, enabled: x } })} label={m.name} hint={v.enabled ? "On: customers can pick it at checkout." : "Off: hidden at checkout."} />
                  {v.enabled && (
                    <Field label={m.detailsLabel!} hint={`${m.detailsHint} Shown to the customer after they place the order.`}>
                      <Input value={v.details} maxLength={120} onChange={(e) => set("payments", { ...p, [id]: { ...v, details: e.target.value } })} />
                    </Field>
                  )}
                </Card>
              );
            }
            const id = m.id as "bank" | "card";
            const v = p[id];
            return (
              <Card key={m.id} className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-medium">{m.name}</span>
                  <Badge>Coming soon</Badge>
                </div>
                <p className="text-sm text-muted">Not connected to a payment provider yet, so customers can’t pay with it. Choose whether to show it greyed out or hide it.</p>
                <Segmented
                  className="max-w-sm"
                  size="sm"
                  value={v.comingSoon}
                  onChange={(x) => set("payments", { ...p, [id]: { ...v, comingSoon: x } })}
                  options={[
                    { value: "hide", label: "Hide completely" },
                    { value: "show", label: "Show as “Coming soon”" },
                  ]}
                />
              </Card>
            );
          })}
        </div>
        <SectionTitle>Extra payment instructions</SectionTitle>
        <Card className="p-4">
          <Field label="Shown under the payment details (optional)" hint="For example: “Send as Friends and Family” or “Payments are checked within a few hours”.">
            <Textarea value={form.paymentNote} maxLength={400} onChange={(e) => set("paymentNote", e.target.value)} className="min-h-[76px]" />
          </Field>
        </Card>
        {saveBar}
      </div>
    );
  }

  // ------------------------------------------------------------ Shipping
  if (tab === "shipping") {
    return (
      <div className="pb-24">
        {keyWarning(keys?.shippo, "SHIPPO_API_KEY", "Live rates and buying labels are off until it is set. Flat-rate shipping still works, and you can mark orders shipped with your own postage.")}
        <SectionTitle>Shipping prices</SectionTitle>
        <Card className="space-y-5 p-4">
          <Field label="How shipping is priced" hint={form.shippingMode === "live" ? "Customers see the real USPS price for their address. If Shippo can’t be reached, the flat prices below are used instead." : "Customers pay the flat price you set for each option."}>
            <Segmented
              className="max-w-sm"
              value={form.shippingMode}
              onChange={(v) => set("shippingMode", v)}
              options={[
                { value: "flat", label: "Flat prices" },
                { value: "live", label: "Live Shippo rates" },
              ]}
            />
          </Field>
          <div className="space-y-3">
            {form.shippingTiers.map((t, i) => (
              <div key={t.id} className={cx("rounded-xl border border-line p-3", !t.enabled && "opacity-60")}>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                  <Field label="Name shown at checkout" hint={TIER_SERVICE[t.id].label}>
                    <Input value={t.name} maxLength={30} onChange={(e) => set("shippingTiers", form.shippingTiers.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                  </Field>
                  <Field label={form.shippingMode === "live" ? "Fallback price" : "Flat price"}>
                    <MoneyInput value={t.flatCents} onChange={(c) => set("shippingTiers", form.shippingTiers.map((x, k) => (k === i ? { ...x, flatCents: c ?? 0 } : x)))} />
                  </Field>
                </div>
                <div className="mt-2">
                  <Toggle checked={t.enabled} onChange={(x) => set("shippingTiers", form.shippingTiers.map((y, k) => (k === i ? { ...y, enabled: x } : y)))} label="Offer this option" />
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">Which options are free is chosen on each free shipping rule in Promotions.</p>
        </Card>

        <SectionTitle>Ship from</SectionTitle>
        <Card className="space-y-4 p-4">
          <p className="text-sm text-muted">Printed on labels and packing slips. Shippo needs the phone and email to sell a label.</p>
          <Field label="Name or business name">
            <Input value={from.name} onChange={(e) => setFrom("name", e.target.value)} autoComplete="organization" />
          </Field>
          <Field label="Street address">
            <Input value={from.street1} onChange={(e) => setFrom("street1", e.target.value)} autoComplete="address-line1" />
          </Field>
          <Field label="Suite, unit (optional)">
            <Input value={from.street2} onChange={(e) => setFrom("street2", e.target.value)} autoComplete="address-line2" />
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_6.5rem] gap-3">
            <Field label="City">
              <Input value={from.city} onChange={(e) => setFrom("city", e.target.value)} />
            </Field>
            <Field label="State">
              <Select value={from.state} onChange={(e) => setFrom("state", e.target.value)}>
                <option value="">–</option>
                {STATES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </Field>
            <Field label="ZIP">
              <Input inputMode="numeric" value={from.zip} onChange={(e) => setFrom("zip", e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone">
              <Input type="tel" value={from.phone} onChange={(e) => setFrom("phone", e.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" value={from.email} onChange={(e) => setFrom("email", e.target.value)} />
            </Field>
          </div>
        </Card>

        <SectionTitle>Default parcel</SectionTitle>
        <Card className="space-y-4 p-4">
          <p className="text-sm text-muted">One box per order. The weight is the box and packing; each size can add its own weight on its Stock and pricing tab.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["lengthIn", "Length", "in"],
                ["widthIn", "Width", "in"],
                ["heightIn", "Height", "in"],
                ["weightOz", "Weight", "oz"],
              ] as const
            ).map(([k, label, unit]) => (
              <Field key={k} label={label}>
                <NumberInput value={form.parcel[k]} min={0.1} max={999} step={0.1} suffix={unit} onChange={(n) => set("parcel", { ...form.parcel, [k]: n ?? 1 })} />
              </Field>
            ))}
          </div>
        </Card>

        <SectionTitle>Shippo</SectionTitle>
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => runTest("shippo")} disabled={testing === "shippo"}>
              {testing === "shippo" ? "Testing…" : "Test Shippo connection"}
            </Button>
            {keys?.shippo && <Badge tone={keys.shippoTest ? "warn" : "pos"}>{keys.shippoTest ? "Test key: labels are samples" : "Live key"}</Badge>}
          </div>
          {result(test.shippo)}
          {keys?.shippo && (
            <div className="mt-4 border-t border-line pt-4">
              <div className="text-sm font-medium">Automatic “Shipped” and “Delivered”</div>
              <p className="mt-1 text-sm text-muted">In Shippo, open API, then Webhooks, and add a webhook for “Track updated” with this address. Orders then update on their own when the carrier scans them. Without it, use “Check tracking” or mark them by hand.</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-surface2 px-3 py-2.5 text-xs">{`${typeof window !== "undefined" ? window.location.origin : ""}${keys.webhookPath}`}</code>
                <Button
                  size="sm"
                  className="h-10 shrink-0"
                  onClick={() => navigator.clipboard.writeText(`${window.location.origin}${keys.webhookPath}`).then(() => toast.show({ message: "Webhook address copied" }))}
                >
                  <Copy size={15} /> Copy
                </Button>
              </div>
            </div>
          )}
        </Card>
        {saveBar}
      </div>
    );
  }

  // ------------------------------------------------------------ Email
  if (tab === "email") {
    const addEmail = () => {
      const e = newEmail.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return toast.show({ message: "That doesn’t look like an email address. Check it and try again.", tone: "error" });
      if (!form.alertEmails.includes(e)) set("alertEmails", [...form.alertEmails, e]);
      setNewEmail("");
    };
    return (
      <div className="pb-24">
        {keyWarning(keys?.resend, "RESEND_API_KEY", "No emails are sent until it is set. Orders still work, and every skipped email is noted on the order.")}
        <SectionTitle>Alert emails</SectionTitle>
        <Card className="space-y-3 p-4">
          <p className="text-sm text-muted">These addresses are told about new orders, payment screenshots and contact messages.</p>
          {form.alertEmails.length > 0 && (
            <ul className="space-y-2">
              {form.alertEmails.map((e) => (
                <li key={e} className="flex items-center gap-2 rounded-xl bg-surface2/70 py-1 pl-4 pr-1">
                  <span className="min-w-0 flex-1 truncate text-[15px]">{e}</span>
                  <button aria-label={`Remove ${e}`} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:text-neg" onClick={() => set("alertEmails", form.alertEmails.filter((x) => x !== e))}>
                    <X size={17} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Input type="email" value={newEmail} placeholder="you@example.com" onChange={(e) => setNewEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEmail())} aria-label="Add alert email" />
            <Button className="h-12 shrink-0" onClick={addEmail} disabled={!newEmail.trim()}>
              <Plus size={17} /> Add
            </Button>
          </div>
        </Card>

        <SectionTitle>Automatic emails</SectionTitle>
        <Card className="space-y-3 p-4">
          <Toggle
            checked={form.unpaidReminder}
            onChange={(v) => set("unpaidReminder", v)}
            label="Unpaid order reminder"
            hint={`When a website order is still unpaid halfway to auto-cancel (after ${form.autoCancelHours / 2} of ${form.autoCancelHours} hours), the customer gets one reminder with the payment instructions and the time left.`}
          />
          <div className="border-t border-line pt-3">
            <Toggle
              checked={form.lowStockAlerts}
              onChange={(v) => set("lowStockAlerts", v)}
              label="Low stock alert"
              hint={form.alertEmails.length ? "The alert emails above are told when a size drops to its low stock warning level." : "Tells the alert emails when a size drops to its low stock warning level. Add an alert email above to receive it."}
            />
          </div>
        </Card>

        <SectionTitle>Sender</SectionTitle>
        <Card className="space-y-4 p-4">
          <Field label="From name" hint="The name customers see in their inbox.">
            <Input value={form.emailFromName} maxLength={60} onChange={(e) => set("emailFromName", e.target.value)} />
          </Field>
          <Field label="From address" hint="Must be on a domain you verified in Resend, like orders@yourdomain.com. Empty = Resend’s test sender, which only delivers to your own Resend account email.">
            <Input type="email" value={form.emailFromAddress} placeholder="orders@buckshotlabs.com" onChange={(e) => set("emailFromAddress", e.target.value)} />
          </Field>
        </Card>

        <SectionTitle>Test</SectionTitle>
        <Card className="p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input type="email" value={testTo} placeholder={form.alertEmails[0] ?? "Send the test to…"} onChange={(e) => setTestTo(e.target.value)} aria-label="Send test email to" />
            <Button className="h-12 shrink-0" onClick={() => runTest("email")} disabled={testing === "email" || dirty}>
              {testing === "email" ? "Sending…" : "Send test email"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">{dirty ? "Save your changes first, then send the test." : "Sent to the address above, or to your first alert email."}</p>
          {result(test.email)}
        </Card>
        {saveBar}
      </div>
    );
  }

  // ------------------------------------------------------------ Referrals and invites
  if (tab === "referrals") {
    const r = form.referrals;
    const setR = (patch: Partial<StoreSettings["referrals"]>) => set("referrals", { ...r, ...patch });
    const example = 10000;
    return (
      <div className="space-y-5" data-referral-settings>
        <SectionTitle>Referral credit</SectionTitle>
        <Card className="space-y-5 p-4">
          <Field label="Referrer reward" hint={`Store credit the code owner earns on every order placed with their code. It is a percent of the order subtotal after all discounts (discount code and referral discount), without shipping or tips. Store credit the buyer spends does not lower it. Rounded down to the cent. Example: a ${fmtMoney(example)} order gives ${fmtMoney(Math.floor((example * r.percent) / 100))}. Owner price orders earn nothing, and nobody can use their own code.`}>
            <NumberInput className="w-40" value={r.percent} min={0} max={100} step={0.5} suffix="%" onChange={(n) => setR({ percent: n ?? 0 })} label="referrer reward percent" />
          </Field>
          <div className="border-t border-line pt-4">
            <Field label="Buyer referral discount" hint={`Discount the buyer gets for using a referral code. 0% = no discount (the code only earns credit for its owner). Example: ${r.buyerDiscountPercent}% of ${fmtMoney(example)} is ${fmtMoney(Math.floor((example * r.buyerDiscountPercent) / 100))} off.`}>
              <NumberInput className="w-40" value={r.buyerDiscountPercent} min={0} max={100} step={0.5} suffix="%" onChange={(n) => setR({ buyerDiscountPercent: n ?? 0 })} label="buyer referral discount percent" />
            </Field>
          </div>
          <div className="border-t border-line pt-4">
            <Toggle checked={r.allowStacking} onChange={(v) => setR({ allowStacking: v })} label="Allow a referral code + a discount code on the same order" hint="On: a customer can use one referral code and one discount code together. Off: only one of the two; checkout asks which one to keep." />
          </div>
          <p className="text-sm text-muted">Changes apply to new orders only: every order keeps the percents it was placed with. Credit is pending while an order is unpaid and becomes spendable when it is marked paid. If an order is canceled or refunded, its referral credit is taken back automatically (in part for a partial refund). If the owner already spent it, their balance goes negative and future credit pays it off first.</p>
        </Card>

        <SectionTitle>Invite links</SectionTitle>
        <Card className="space-y-3 p-4">
          <Field label="Invite links work for" hint="A customer you add with an email gets a store account with no password. The invite link (and the claim link sent when someone signs up with an email you already have) lets them choose one. Each link works once, and making a new one turns off the old one.">
            <NumberInput className="w-40" value={r.inviteDays} min={1} max={90} step={1} suffix="days" onChange={(n) => setR({ inviteDays: Math.max(1, Math.min(90, Math.round(n ?? 14))) })} label="invite days" />
          </Field>
        </Card>
        {saveBar}
      </div>
    );
  }

  // ------------------------------------------------------------ Local pickup and delivery
  if (tab === "local") {
    const l = form.local;
    const setL = (patch: Partial<StoreSettings["local"]>) => set("local", { ...l, ...patch });
    const setP = (patch: Partial<StoreSettings["local"]["pickup"]>) => setL({ pickup: { ...l.pickup, ...patch } });
    const setD = (patch: Partial<StoreSettings["local"]["delivery"]>) => setL({ delivery: { ...l.delivery, ...patch } });
    return (
      <div className="space-y-5" data-local-settings>
        <SectionTitle>Local area</SectionTitle>
        <Card className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Home ZIP code" hint="Private: never shown to customers. Distance is measured from the center of this ZIP.">
              <Input value={l.homeZip} inputMode="numeric" maxLength={5} placeholder="48127" onChange={(e) => setL({ homeZip: e.target.value.replace(/\D/g, "").slice(0, 5) })} data-home-zip />
            </Field>
            <Field label="Local radius" hint="Straight-line miles. Customers inside it see local pickup and delivery at checkout.">
              <NumberInput className="w-40" value={l.radiusMiles} min={1} max={200} step={1} suffix="mi" onChange={(n) => setL({ radiusMiles: Math.max(1, Math.min(200, n ?? 15)) })} label="local radius" />
            </Field>
          </div>
        </Card>

        <SectionTitle>Local pickup</SectionTitle>
        <Card className="space-y-4 p-4">
          <Toggle checked={l.pickup.enabled} onChange={(v) => setP({ enabled: v })} label="Offer local pickup (free)" hint="Customers see only the town of the pickup spot until their order is placed." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pickup spot name" hint="A PUBLIC place, e.g. a store parking lot. Never your home.">
              <Input value={l.pickup.name} maxLength={120} placeholder="Target parking lot (near the entrance)" onChange={(e) => setP({ name: e.target.value })} />
            </Field>
            <Field label="Street address">
              <Input value={l.pickup.street1} maxLength={160} onChange={(e) => setP({ street1: e.target.value })} />
            </Field>
            <Field label="Town" hint="Shown before checkout: “Pickup spot in Dearborn Heights area”.">
              <Input value={l.pickup.city} maxLength={80} onChange={(e) => setP({ city: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="State">
                <Select value={l.pickup.state} onChange={(e) => setP({ state: e.target.value })}>
                  <option value="">—</option>
                  {STATES.map((st) => (
                    <option key={st}>{st}</option>
                  ))}
                </Select>
              </Field>
              <Field label="ZIP">
                <Input value={l.pickup.zip} inputMode="numeric" maxLength={10} onChange={(e) => setP({ zip: e.target.value })} />
              </Field>
            </div>
          </div>
          <Field label="Pickup instructions" hint="Sent after the order is placed, with the address.">
            <Textarea value={l.pickup.instructions} maxLength={1000} rows={3} placeholder="Park near the cart return. Text us when you arrive." onChange={(e) => setP({ instructions: e.target.value })} />
          </Field>
          {l.pickup.enabled && !(l.pickup.name.trim() && l.pickup.street1.trim() && l.pickup.city.trim()) && <p className="text-sm text-warn">Fill in the spot name, street and town: until then pickup is hidden at checkout.</p>}
        </Card>

        <SectionTitle>Local delivery</SectionTitle>
        <Card className="space-y-4 p-4">
          <Toggle checked={l.delivery.enabled} onChange={(v) => setD({ enabled: v })} label="Offer local delivery" hint="Charged like shipping, but no label is bought." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Delivery fee">
              <MoneyInput value={l.delivery.feeCents} onChange={(c) => setD({ feeCents: Math.max(0, c ?? 0) })} label="delivery fee" />
            </Field>
            <Field label="Free local delivery over" hint="Items after discounts. Leave empty for never free. Separate from free shipping rules.">
              <MoneyInput value={l.delivery.freeOverCents} nullable placeholder="Off" onChange={(c) => setD({ freeOverCents: c && c > 0 ? c : null })} label="free delivery over" />
            </Field>
          </div>
        </Card>

        <SectionTitle>Payment and times</SectionTitle>
        <Card className="space-y-4 p-4">
          <Toggle checked={l.payAtPickup} onChange={(v) => setL({ payAtPickup: v })} label="Allow “pay at pickup / delivery” (cash or Zelle)" hint="Only offered on local orders. Such orders are never auto-canceled; mark them paid when you get the money." />
          <div className="border-t border-line pt-4">
            <div className="mb-2 text-sm font-medium">Available time windows</div>
            <div className="space-y-2">
              {l.windows.map((w, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={w} maxLength={60} onChange={(e) => setL({ windows: l.windows.map((x, k) => (k === i ? e.target.value : x)) })} aria-label={`Time window ${i + 1}`} />
                  <Button variant="soft" className="h-12 shrink-0" aria-label={`Remove time window ${i + 1}`} onClick={() => setL({ windows: l.windows.filter((_, k) => k !== i) })}>
                    <X size={16} />
                  </Button>
                </div>
              ))}
              <Button variant="soft" size="sm" className="h-10" onClick={() => setL({ windows: [...l.windows, l.windows.length ? "" : "Weekdays 5–9pm"] })} data-add-window>
                <Plus size={16} /> Add a time window
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">Customers pick one as their preferred time. You text them to confirm the exact time.</p>
          </div>
        </Card>

        <LocalAreaPreview zip={l.homeZip} radius={l.radiusMiles} />
        {saveBar}
      </div>
    );
  }

  return <Backups />;
}

/** "Your local area covers N ZIP codes", from the values in the form (before saving), so the owner can check it. */
function LocalAreaPreview({ zip, radius }: { zip: string; radius: number }) {
  const [data, setData] = useState<{ home: { town: string; state: string }; zips: { zip: string; town: string; state: string; miles: number }[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (zip.length !== 5) {
      setData(null);
      setError(zip ? "" : "Enter your home ZIP code to see the local area.");
      return;
    }
    const t = setTimeout(() => {
      api<NonNullable<typeof data>>(`/api/local/zips?zip=${zip}&radius=${radius}`)
        .then((d) => (setData(d), setError("")))
        .catch((e) => (setData(null), setError((e as Error).message)));
    }, 300);
    return () => clearTimeout(t);
  }, [zip, radius]);
  const towns = data ? [...new Set(data.zips.map((z) => z.town).filter(Boolean))] : [];
  return (
    <Card className="p-4" data-local-area>
      {error ? (
        <p className="text-sm text-muted">{error}</p>
      ) : !data ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <div className="font-medium" data-local-count>
            Your local area covers {data.zips.length} ZIP code{data.zips.length === 1 ? "" : "s"}
            <span className="font-normal text-muted">
              {" "}
              ({radius} mi around {data.home.town || zip}
              {data.home.state ? `, ${data.home.state}` : ""}) · {towns.length} towns
            </span>
          </div>
          <ul className="mt-3 grid max-h-80 grid-cols-1 gap-x-4 overflow-y-auto text-sm sm:grid-cols-2" data-local-zips>
            {data.zips.map((z) => (
              <li key={z.zip} className="flex justify-between gap-3 border-b border-line py-1.5">
                <span>
                  <span className="font-mono">{z.zip}</span> {z.town || "—"}
                  {z.state ? `, ${z.state}` : ""}
                </span>
                <span className="tabular-nums text-muted">{z.miles} mi</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Distance is straight-line between ZIP centers (US Census data). ZIPs not in the data are never local.</p>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Backups
interface BackupFile {
  name: string;
  sizeBytes: number;
  createdAt: string;
  manual: boolean;
}

function Backups() {
  const toast = useToast();
  const [list, setList] = useState<{ backups: BackupFile[]; keep: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () =>
    api<{ backups: BackupFile[]; keep: number }>("/api/backups")
      .then((r) => (setList(r), setError("")))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    load();
  }, []);
  const size = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  return (
    <div className="pb-10">
      <SectionTitle>Database backups</SectionTitle>
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">A full copy of the database is saved every day. The last {list?.keep ?? 14} are kept on the server, next to the database.</p>
          <Button
            variant="primary"
            className="shrink-0"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/api/backups", "POST");
                await load();
                toast.show({ message: "Backup saved", tone: "success" });
              } catch (e) {
                toast.show({ message: (e as Error).message, tone: "error", duration: 7000 });
              }
              setBusy(false);
            }}
          >
            {busy ? "Backing up…" : "Back up now"}
          </Button>
        </div>
        {error ? (
          <p className="mt-4 rounded-xl bg-neg/10 px-4 py-3 text-sm text-neg">Couldn’t load the list of backups: {error}</p>
        ) : !list ? (
          <div className="mt-4 h-24 animate-shimmer rounded-xl bg-surface2" />
        ) : list.backups.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">No backups yet. The first automatic one is made within an hour of the server starting, or press “Back up now”.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
            {list.backups.map((b) => (
              <li key={b.name} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{fmtDateTime(b.createdAt)}</div>
                  <div className="text-xs text-muted">
                    {b.manual ? "Manual" : "Automatic"} · {size(b.sizeBytes)}
                  </div>
                </div>
                <a href={`/api/backups?file=${encodeURIComponent(b.name)}`} download={b.name}>
                  <Button size="sm" className="h-10">
                    <Download size={15} /> Download
                  </Button>
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">Download one now and then and keep it somewhere else: the server volume is otherwise the only copy. Photos and COA files are stored separately and are not inside these files.</p>
      </Card>
    </div>
  );
}
