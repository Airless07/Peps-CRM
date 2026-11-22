"use client";

import { sizeWithVolume } from "@/lib/size";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CreditCard, Landmark, Lock } from "lucide-react";
import { accountApi, AuthPanel, cleanError, type AccountInfo } from "./auth-panel";
import { resetCheckoutStart, trackCheckoutStart } from "./analytics";
import { CartTotals, money, PromoField, useCart, useLineInfo } from "./cart";

type Addr = AccountInfo["addresses"][number];
const BLANK: Addr = { name: "", street1: "", street2: "", city: "", state: "", zip: "", country: "US" };

function PayIcon({ id }: { id: string }) {
  const box = "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-rule bg-paper text-coal";
  if (id === "bank") return <span className={box}><Landmark size={19} strokeWidth={1.6} /></span>;
  if (id === "card") return <span className={box}><CreditCard size={19} strokeWidth={1.6} /></span>;
  const letter = { zelle: "Z", cashapp: "$", venmo: "V" }[id] ?? "•";
  return (
    <span className={`${box} text-[17px] font-bold`} aria-hidden>
      {letter}
    </span>
  );
}

/** Turn the words Terms, Privacy, Shipping and Returns into links. */
function PolicyText({ text }: { text: string }) {
  const map: Record<string, string> = { terms: "/terms", privacy: "/privacy", shipping: "/shipping", returns: "/refunds", refunds: "/refunds", refund: "/refunds" };
  return (
    <>
      {text.split(/\b(Terms|Privacy|Shipping|Returns|Refunds|Refund)\b/i).map((part, i) =>
        map[part.toLowerCase()] ? (
          <Link key={i} href={map[part.toLowerCase()]} target="_blank" className="s-link">
            {part}
          </Link>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Step({ n, title, done, children, aside }: { n: number; title: string; done?: boolean; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-t border-rule py-8 first:border-t-0 first:pt-0">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 text-xl font-semibold">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums ${done ? "bg-coal text-white" : "border border-coal text-coal"}`}>{done ? <Check size={14} /> : n}</span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function CheckoutView({ account: initial, states, ack, preview }: { account: AccountInfo | null; states: string[]; ack: { research: string; policies: string }; preview: boolean }) {
  const cart = useCart();
  const info = useLineInfo();
  const router = useRouter();
  const [account, setAccount] = useState<AccountInfo | null>(initial);
  const [a, setA] = useState<Addr>(initial?.addresses[0] ?? { ...BLANK, name: initial?.name ?? "" });
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [tier, setTier] = useState<string>("");
  const [pay, setPay] = useState("");
  const [ack1, setAck1] = useState(false);
  const [ack2, setAck2] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creditWanted, setCreditWanted] = useState(0);
  const [creditCustom, setCreditCustom] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const { quote, requote } = cart;

  // Checkout fields belong to one account. When the account changes (sign out, or another account signed
  // in from another tab) every field is reset at once: nothing typed for, or filled from, the previous
  // account is shown for even a moment.
  const fillFrom = (acc: AccountInfo | null) => {
    setA(acc?.addresses[0] ?? { ...BLANK, name: acc?.name ?? "" });
    setPhone(acc?.phone ?? "");
    setCreditWanted(0);
    setCreditCustom(false);
    setErrors({});
    setFormError("");
    setAck1(false);
    setAck2(false);
    setPay("");
    setTier("");
  };
  useEffect(() => {
    if (!cart.ready) return;
    if (cart.owner === (account?.id ?? null)) return;
    if (cart.owner === null) {
      setAccount(null);
      fillFrom(null);
    } else if (initial?.id === cart.owner) {
      setAccount(initial);
      fillFrom(initial);
    } else {
      // Signed in as someone else elsewhere: show nothing of the old account, then load the new one.
      setAccount(null);
      fillFrom(null);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.owner, cart.ready, initial?.id]);

  const addressComplete = a.street1.trim().length >= 3 && a.city.trim().length >= 2 && !!a.state && /^\d{5}(-\d{4})?$/.test(a.zip.trim());
  // Live shipping prices depend on the address: re-price when it is complete or changes.
  const addrKey = addressComplete ? [a.street1, a.city, a.state, a.zip].join("|") : "";
  useEffect(() => {
    const t = setTimeout(() => requote(addrKey ? { street1: a.street1, street2: a.street2, city: a.city, state: a.state, zip: a.zip } : null), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addrKey]);

  // Analytics: a checkout is "started" when the page is opened with something in the cart.
  const hasItems = cart.ready && cart.items.length > 0;
  useEffect(() => {
    if (hasItems) trackCheckoutStart();
  }, [hasItems]);

  const options = quote?.shipping ?? [];
  // Local pickup / delivery: offered only when the address ZIP is local (decided by the server).
  const local = addressComplete ? quote?.local ?? null : null;
  const [method, setMethod] = useState<"ship" | "pickup" | "delivery">("ship");
  const [localTime, setLocalTime] = useState("");
  const [localNotes, setLocalNotes] = useState("");
  const isLocal = method !== "ship";
  // Address changed to a non-local ZIP (or the option was turned off): back to shipping.
  useEffect(() => {
    if ((method === "pickup" && !local?.pickup) || (method === "delivery" && !local?.delivery)) setMethod("ship");
  }, [local, method]);
  useEffect(() => {
    if (local?.windows.length && !local.windows.includes(localTime)) setLocalTime("");
  }, [local, localTime]);
  const payAtPickupOn = isLocal && !!local?.payAtPickup;
  const methods = useMemo(
    () => [...(quote?.payMethods ?? []), ...(payAtPickupOn ? [{ id: "pickup", name: method === "delivery" ? "Pay at delivery" : "Pay at pickup", blurb: "Cash or Zelle when we meet. Your order is held for you.", available: true }] : [])],
    [quote?.payMethods, payAtPickupOn, method],
  );
  useEffect(() => {
    if (options.length && !options.some((o) => o.tier === tier)) setTier(options[0].tier);
  }, [options, tier]);
  useEffect(() => {
    const ok = methods.filter((m) => m.available);
    if (ok.length && !ok.some((m) => m.id === pay)) setPay(ok[0].id);
  }, [methods, pay]);

  const shipOption = options.find((o) => o.tier === tier);
  // What the summary and the total use: the shipping option, or the local method's price.
  const ship = isLocal
    ? { name: method === "pickup" ? "Local pickup" : "Local delivery", cents: method === "delivery" ? local?.delivery?.cents ?? 0 : 0 }
    : shipOption;
  // Store credit: never more than what is available or the total after discounts. Taken from the balance once paid.
  const creditAvail = account ? quote?.credit?.availableCents ?? 0 : 0;
  const creditMax = quote ? Math.max(0, Math.min(creditAvail, quote.subtotalCents - quote.discountCents)) : 0;
  const creditUsed = Math.min(creditWanted, creditMax);
  const total = quote && ship ? quote.subtotalCents - quote.discountCents - creditUsed + ship.cents : null;
  const soldOut = quote?.lines.filter((l) => l.stock === "out") ?? [];
  const lines = useMemo(() => (quote?.lines ?? []).map((l) => ({ l, meta: info(l.variantId) })), [quote, info]);

  const set = (k: keyof Addr, v: string) => {
    setA((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: "" }));
  };
  // The summary message goes away once nothing is flagged any more.
  useEffect(() => {
    if (formError && Object.values(errors).every((x) => !x)) setFormError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errors]);

  async function place() {
    const e: Record<string, string> = {};
    if (a.name.trim().length < 2) e.name = "Enter the full name for the shipping label.";
    if (a.street1.trim().length < 3) e.street1 = "Enter the street address.";
    if (a.city.trim().length < 2) e.city = "Enter the city.";
    if (!a.state) e.state = "Pick a state.";
    if (!/^\d{5}(-\d{4})?$/.test(a.zip.trim())) e.zip = "Enter a 5 digit ZIP code.";
    if (!ship) e.ship = "Pick a shipping option.";
    if (isLocal && phone.replace(/\D/g, "").length < 10) e.phone = "Enter a phone number so we can text you about the time.";
    if (isLocal && local?.windows.length && !localTime) e.localTime = "Pick a preferred time.";
    if (!pay) e.pay = "Pick a payment method.";
    if (!ack1 || !ack2) e.ack = "Tick both boxes to place your order.";
    setErrors(e);
    if (Object.keys(e).length || total === null) {
      setFormError("Some details are missing. Check the highlighted fields.");
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true'], [data-invalid='true']")?.scrollIntoView({ block: "center", behavior: "smooth" }));
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      const res = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account?.id ?? null, phone, shipTo: { ...a, zip: a.zip.trim() }, items: cart.items, code: quote?.code ?? "", tier: isLocal ? "" : tier, fulfillment: method, localTime: isLocal ? localTime : "", localNotes: isLocal ? localNotes : "", payChoice: pay, expectedTotalCents: total, ackResearch: true, ackPolicies: true, saveAddress: true, storeCreditCents: creditUsed, referralCode: quote?.referral ? cart.referral : "" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) setAccount(null);
        if (res.status === 409) await requote(addrKey ? { street1: a.street1, street2: a.street2, city: a.city, state: a.state, zip: a.zip } : null);
        throw new Error(cleanError(json.error) || "We couldn't place your order. Check your connection and try again.");
      }
      cart.clear();
      resetCheckoutStart();
      router.push(`/order/${json.token}?placed=1`);
    } catch (err) {
      setFormError((err as Error).message);
      setBusy(false);
      requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
    }
  }

  if (!cart.ready) return <div className="s-wrap py-24" aria-busy="true" />;
  if (cart.items.length === 0 && !busy) {
    return (
      <div className="s-wrap flex min-h-[50dvh] flex-col items-center justify-center py-20 text-center">
        <h1 className="text-3xl font-semibold">Your cart is empty</h1>
        <p className="mt-2 text-stone">Add a product before checking out.</p>
        <Link href="/shop" className="s-btn-primary mt-7">
          Shop all products
        </Link>
      </div>
    );
  }

  const field = (k: keyof Addr, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <div>
      <label className="s-label" htmlFor={`co-${k}`}>
        {label}
      </label>
      <input id={`co-${k}`} className={`s-input ${errors[k] ? "!border-brand" : ""}`} value={a[k]} onChange={(e) => set(k, e.target.value)} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `co-${k}-err` : undefined} {...props} />
      {errors[k] ? (
        <span id={`co-${k}-err`} className="s-error">
          {errors[k]}
        </span>
      ) : (
        hint && <span className="s-hint">{hint}</span>
      )}
    </div>
  );

  const summary = (
    <aside className="order-first h-fit rounded-2xl bg-soft p-5 sm:p-6 lg:sticky lg:top-36 lg:order-last">
      <h2 className="text-lg font-semibold">Order summary</h2>
      <ul className="mt-4 divide-y divide-rule border-y border-rule">
        {lines.map(({ l, meta }) => (
          <li key={l.variantId} className="flex items-start justify-between gap-4 py-3 text-[15px]">
            <span className="min-w-0" data-checkout-line>
              <span className="block font-medium">{meta?.product.name ?? l.name}</span>
              <span className="block text-[13px] text-stone">
                {[meta ? sizeWithVolume(meta.variant.label, meta.variant.volume) : "", `Qty ${l.quantity}`, l.percentOff ? `${l.percentOff}% off` : ""].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">{money(l.lineTotalCents)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4">{quote ? <CartTotals shippingCents={ship ? ship.cents : null} shippingLabel={ship?.name} creditCents={creditUsed} /> : <div className="h-24 animate-pulse rounded-xl bg-rule/60" />}</div>
      <div className="mt-5 space-y-2.5 border-t border-rule pt-4">
        <PromoField offerLast />
      </div>
      {account && creditAvail > 0 && (
        <div className="mt-5 border-t border-rule pt-4" data-checkout-credit>
          <div className="flex items-baseline justify-between gap-3 text-[15px]">
            <span className="font-medium">Store credit</span>
            <span className="tabular-nums text-stone">{money(creditAvail)} available</span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" data-apply-credit aria-pressed={creditUsed > 0 && creditUsed === creditMax && !creditCustom} onClick={() => (setCreditCustom(false), setCreditWanted(creditMax))} className={`h-10 rounded-full border px-4 text-sm font-medium transition ${creditUsed > 0 && creditUsed === creditMax && !creditCustom ? "border-coal bg-paper" : "border-rule hover:border-coal"}`}>
              Apply all{creditMax < creditAvail ? ` (${money(creditMax)})` : ""}
            </button>
            {creditCustom ? (
              <label className="flex h-10 items-center gap-1 rounded-full border border-coal bg-paper px-4 text-sm">
                <span className="text-stone">$</span>
                <input
                  autoFocus
                  inputMode="decimal"
                  aria-label="Store credit to use"
                  className="w-20 bg-transparent tabular-nums outline-none"
                  defaultValue={creditUsed ? (creditUsed / 100).toFixed(2) : ""}
                  onChange={(e) => {
                    const v = Math.round(parseFloat(e.target.value.replace(/[^0-9.]/g, "")) * 100);
                    setCreditWanted(Number.isFinite(v) ? Math.max(0, Math.min(creditMax, v)) : 0);
                  }}
                />
              </label>
            ) : (
              <button type="button" onClick={() => setCreditCustom(true)} className="h-10 rounded-full border border-rule px-4 text-sm font-medium transition hover:border-coal">
                Use part of it
              </button>
            )}
            {creditUsed > 0 && (
              <button type="button" onClick={() => (setCreditCustom(false), setCreditWanted(0))} className="h-10 rounded-full px-3 text-sm font-medium text-stone underline decoration-rule underline-offset-4 hover:text-coal">
                Don’t use
              </button>
            )}
          </div>
          {creditUsed > 0 && (
            <p className="mt-2 text-sm text-stone" data-credit-live>
              Credit used <strong className="font-semibold text-coal tabular-nums">{money(creditUsed)}</strong>, remaining after this order <strong className="font-semibold text-coal tabular-nums">{money(creditAvail - creditUsed)}</strong>
            </p>
          )}
        </div>
      )}
      <Link href="/cart" className="mt-4 block text-center text-sm font-medium text-stone underline decoration-rule underline-offset-4 hover:text-coal">
        Edit cart
      </Link>
    </aside>
  );

  return (
    <div className="s-wrap pb-8 pt-8 sm:pt-12">
      <h1 className="text-4xl font-semibold leading-[1.05] sm:text-5xl" style={{ letterSpacing: "-0.03em" }}>
        Checkout
      </h1>
      {preview && <p className="mt-4 rounded-xl bg-soft px-4 py-3 text-[15px]">Preview mode: the store is closed, so the order can’t be placed. Open the store in Settings to test a real order.</p>}
      <div className="mt-8 grid gap-x-16 gap-y-8 lg:grid-cols-[1.35fr_1fr]">
        <div className="min-w-0">
          <Step
            n={1}
            title="Account"
            done={!!account}
            aside={
              account && (
                <button
                  type="button"
                  className="text-sm font-medium text-stone underline decoration-rule underline-offset-4 hover:text-coal"
                  onClick={async () => {
                    await accountApi({ action: "signout" }).catch(() => {});
                    setAccount(null);
                    fillFrom(null);
                    router.refresh();
                  }}
                >
                  Not you? Sign out
                </button>
              )
            }
          >
            {account ? (
              <p className="text-[15px]">
                Signed in as <strong className="font-semibold">{account.name}</strong> <span className="text-stone">({account.email})</span>. Order updates go to this email.
              </p>
            ) : (
              <div className="max-w-md">
                <AuthPanel
                  intro="An account is needed to check out. It takes a few seconds, and your cart stays as it is."
                  onDone={(acc) => {
                    // The cart switches to this account's cart (guest items added in, codes re-entered) and re-prices for it.
                    setAccount(acc);
                    fillFrom(acc);
                    router.refresh();
                  }}
                />
              </div>
            )}
          </Step>

          <fieldset disabled={!account} className={account ? "" : "pointer-events-none select-none opacity-40"} aria-hidden={!account}>
            <Step n={2} title="Shipping address" done={addressComplete && a.name.trim().length >= 2}>
              {account && account.addresses.length > 0 && (
                <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Saved addresses">
                  {account.addresses.map((s, i) => {
                    const on = s.street1 === a.street1 && s.zip === a.zip && s.name === a.name;
                    return (
                      <button key={i} type="button" aria-pressed={on} onClick={() => (setA(s), setErrors({}))} className={`rounded-xl border px-3.5 py-2.5 text-left text-sm transition ${on ? "border-coal bg-soft" : "border-rule hover:border-coal"}`}>
                        <span className="block font-medium">{s.name}</span>
                        <span className="block text-stone">
                          {s.street1}, {s.city} {s.state}
                        </span>
                      </button>
                    );
                  })}
                  <button type="button" onClick={() => setA({ ...BLANK, name: account.name })} className="rounded-xl border border-dashed border-rule px-3.5 py-2.5 text-sm font-medium text-stone hover:border-coal hover:text-coal">
                    New address
                  </button>
                </div>
              )}
              <div className="grid gap-4">
                {field("name", "Full name", { autoComplete: "shipping name" })}
                {field("street1", "Street address", { autoComplete: "shipping address-line1" })}
                {field("street2", "Apartment, suite, unit (optional)", { autoComplete: "shipping address-line2" })}
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-[1.4fr_1fr_1fr]">
                  <div className="col-span-2 sm:col-span-1">{field("city", "City", { autoComplete: "shipping address-level2" })}</div>
                  <div>
                    <label className="s-label" htmlFor="co-state">
                      State
                    </label>
                    <select id="co-state" className={`s-input pr-8 ${errors.state ? "!border-brand" : ""}`} value={a.state} onChange={(e) => set("state", e.target.value)} autoComplete="shipping address-level1" aria-invalid={!!errors.state}>
                      <option value="">Select</option>
                      {states.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    {errors.state && <span className="s-error">{errors.state}</span>}
                  </div>
                  {field("zip", "ZIP code", { autoComplete: "shipping postal-code", inputMode: "numeric", maxLength: 10 })}
                </div>
                <div>
                  <label className="s-label" htmlFor="co-phone">
                    {isLocal ? "Phone" : "Phone (optional)"}
                  </label>
                  <input id="co-phone" type="tel" className={`s-input ${errors.phone ? "!border-brand" : ""}`} autoComplete="tel" value={phone} aria-invalid={!!errors.phone} onChange={(e) => (setPhone(e.target.value), setErrors((x) => ({ ...x, phone: "" })))} />
                  {errors.phone ? <span className="s-error">{errors.phone}</span> : <span className="s-hint">{isLocal ? "Needed for local pickup or delivery: we text you to confirm the time." : "Recommended for delivery updates."}</span>}
                </div>
              </div>
            </Step>

            <Step n={3} title="Shipping method" done={!!ship}>
              {local && (
                <div className="mb-5 rounded-2xl border border-brand/30 bg-brand-tint/60 p-4 sm:p-5" data-local-prompt>
                  <p className="text-[1.0625rem] font-semibold">Looks like you’re local! Skip shipping?</p>
                  <div role="radiogroup" aria-label="Local options" className="mt-3 space-y-2.5">
                    {(
                      [
                        local.pickup && { id: "pickup" as const, name: "Local pickup", sub: `Pickup spot in ${local.pickup.town} area, shared after your order is confirmed.`, price: "FREE" },
                        local.delivery && {
                          id: "delivery" as const,
                          name: "Local delivery",
                          sub: local.delivery.freeOverCents && local.delivery.cents > 0 ? `Free on orders of ${money(local.delivery.freeOverCents)} or more.` : "We bring it to your address.",
                          price: local.delivery.cents === 0 ? "FREE" : money(local.delivery.cents),
                        },
                        { id: "ship" as const, name: "Ship it", sub: "Normal shipping options and prices.", price: "" },
                      ].filter(Boolean) as { id: "ship" | "pickup" | "delivery"; name: string; sub: string; price: string }[]
                    ).map((o) => {
                      const on = method === o.id;
                      return (
                        <label key={o.id} className={`flex cursor-pointer items-center gap-4 rounded-xl border bg-paper px-4 py-3.5 transition ${on ? "border-coal" : "border-rule hover:border-coal"}`} data-local-option={o.id}>
                          <input type="radio" name="fulfillment" className="h-5 w-5 shrink-0 accent-[var(--s-brand)]" checked={on} onChange={() => (setMethod(o.id), setErrors((x) => ({ ...x, ship: "" })))} />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">{o.name}</span>
                            <span className="block text-sm text-stone">{o.sub}</span>
                          </span>
                          {o.price && <span className={`shrink-0 font-semibold tabular-nums ${o.price === "FREE" ? "text-brand" : ""}`}>{o.price}</span>}
                        </label>
                      );
                    })}
                  </div>
                  {isLocal && (
                    <div className="mt-4 grid gap-4" data-local-details>
                      {local.windows.length > 0 && (
                        <div>
                          <label className="s-label" htmlFor="co-time">
                            Preferred time
                          </label>
                          <select id="co-time" className={`s-input pr-8 ${errors.localTime ? "!border-brand" : ""}`} value={localTime} aria-invalid={!!errors.localTime} onChange={(e) => (setLocalTime(e.target.value), setErrors((x) => ({ ...x, localTime: "" })))}>
                            <option value="">Select a time</option>
                            {local.windows.map((w) => (
                              <option key={w}>{w}</option>
                            ))}
                          </select>
                          {errors.localTime && <span className="s-error">{errors.localTime}</span>}
                        </div>
                      )}
                      <div>
                        <label className="s-label" htmlFor="co-local-notes">
                          Notes (optional)
                        </label>
                        <textarea id="co-local-notes" className="s-input min-h-20 py-3" maxLength={500} value={localNotes} onChange={(e) => setLocalNotes(e.target.value)} placeholder={method === "pickup" ? "Anything we should know?" : "Gate code, where to leave it…"} />
                      </div>
                      <p className="text-sm text-stone">We’ll text you to confirm the exact time.</p>
                    </div>
                  )}
                </div>
              )}
              {isLocal ? null : options.length === 0 ? (
                <div className="h-28 animate-pulse rounded-xl bg-soft" />
              ) : (
                <div role="radiogroup" aria-label="Shipping method" className="space-y-2.5" data-invalid={!!errors.ship}>
                  {options.map((o) => {
                    const on = o.tier === tier;
                    return (
                      <label key={o.tier} className={`flex cursor-pointer items-center gap-4 rounded-xl border px-4 py-3.5 transition ${on ? "border-coal bg-soft" : "border-rule hover:border-coal"}`}>
                        <input type="radio" name="ship" className="h-5 w-5 shrink-0 accent-[var(--s-brand)]" checked={on} onChange={() => (setTier(o.tier), setErrors((x) => ({ ...x, ship: "" })))} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{o.name}</span>
                          <span className="block text-sm text-stone">{[o.service, o.estimate].filter(Boolean).join(" · ") || { standard: "USPS Ground Advantage", priority: "USPS Priority Mail", express: "USPS Priority Mail Express" }[o.tier]}</span>
                        </span>
                        <span className="shrink-0 text-right font-semibold tabular-nums">
                          {o.free ? (
                            <>
                              <span className="text-brand">Free</span>
                              <s className="ml-2 text-sm font-normal text-stone">{money(o.baseCents)}</s>
                            </>
                          ) : (
                            money(o.cents)
                          )}
                        </span>
                      </label>
                    );
                  })}
                  {quote?.shippingEstimated && <p className="s-hint">{addressComplete ? "Live carrier prices are not available right now, so standard prices are shown." : "Enter your address to see the exact carrier price."}</p>}
                </div>
              )}
            </Step>

            <Step n={4} title="Payment" done={!!pay}>
              {methods.length === 0 && quote ? (
                <p className="rounded-xl bg-soft px-4 py-3 text-[15px]">Payment is not set up yet, so orders can’t be placed right now. Please check back soon or contact us.</p>
              ) : (
                <div role="radiogroup" aria-label="Payment method" className="grid gap-2.5 sm:grid-cols-2" data-invalid={!!errors.pay}>
                  {methods.map((m) => {
                    const on = m.id === pay;
                    return (
                      <label key={m.id} className={`relative flex items-center gap-3.5 rounded-xl border px-4 py-3.5 transition ${!m.available ? "cursor-not-allowed border-rule opacity-55" : on ? "cursor-pointer border-coal bg-soft" : "cursor-pointer border-rule hover:border-coal"}`}>
                        <input type="radio" name="pay" className="sr-only" disabled={!m.available} checked={on} onChange={() => setPay(m.id)} />
                        <PayIcon id={m.id} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 font-medium">
                            {m.name}
                            {!m.available && <span className="rounded-full bg-rule px-2 py-0.5 text-[11px] font-semibold text-stone">Coming soon</span>}
                          </span>
                          <span className="block text-[13px] leading-snug text-stone">{m.blurb}</span>
                        </span>
                        {on && <Check size={18} className="shrink-0 text-brand" />}
                      </label>
                    );
                  })}
                </div>
              )}
              <p className="s-hint mt-3">{pay === "pickup" ? "You pay in person at the handover, in cash or by Zelle." : "You pay after placing the order. The next page shows exactly where to send the payment and your order number for the memo."}</p>
            </Step>

            <section className="border-t border-rule pt-8">
              <div className="space-y-3" data-invalid={!!errors.ack}>
                {(
                  [
                    [ack1, setAck1, ack.research, false],
                    [ack2, setAck2, ack.policies, true],
                  ] as const
                ).map(([on, setOn, text, links], i) => (
                  <label key={i} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 text-[15px] leading-snug transition ${on ? "border-coal bg-soft" : errors.ack ? "border-brand" : "border-rule"}`}>
                    <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--s-brand)]" checked={on} onChange={(e) => (setOn(e.target.checked), setErrors((x) => ({ ...x, ack: "" })))} />
                    <span>{links ? <PolicyText text={text} /> : text}</span>
                  </label>
                ))}
                {errors.ack && <span className="s-error">{errors.ack}</span>}
              </div>

              <div ref={errorRef}>
                {(formError || soldOut.length > 0 || cart.quoteError) && (
                  <p className="mt-5 rounded-xl bg-brand-tint px-4 py-3 text-[15px] font-medium text-brand-deep" role="alert">
                    {soldOut.length > 0 ? `${soldOut.map((l) => l.name).join(", ")} sold out. Remove ${soldOut.length === 1 ? "it" : "them"} from your cart to continue.` : formError || cart.quoteError}
                  </p>
                )}
              </div>

              <button type="button" onClick={place} disabled={busy || preview || soldOut.length > 0 || total === null || methods.every((m) => !m.available) || !!quote?.conflict} className="s-btn-primary mt-5 h-14 w-full text-base">
                <Lock size={17} /> {busy ? "Placing your order…" : total !== null ? `Place order · ${money(total)}` : "Place order"}
              </button>
              <p className="mt-3 text-center text-[13px] text-stone">No payment is taken on this site. You will get payment instructions right after.</p>
            </section>
          </fieldset>
        </div>
        {summary}
      </div>
    </div>
  );
}
