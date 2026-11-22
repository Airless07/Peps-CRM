"use client";

// Cart state for the store. Items and the discount code live in localStorage; every price comes
// from the server (/api/store/quote), so the drawer, the cart page and checkout always agree.
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, ShoppingBag, Tag, X } from "lucide-react";
import { sizeWithVolume } from "@/lib/size";
import type { PublicProduct } from "@/lib/store/catalog";
import { Vial } from "./vial";

export const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const KEY = "bp-cart";
/** A typed code as kept in the cart: letters, numbers, dashes and underscores, as typed (the server ignores case). */
const cleanTyped = (c: string) => c.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 30);

export interface CartItem {
  variantId: string;
  quantity: number;
}

export interface QuoteLine {
  variantId: string;
  listingId: string;
  name: string;
  quantity: number;
  listPriceCents: number;
  unitPriceCents: number;
  percentOff: number;
  lineTotalCents: number;
  stock: "in" | "low" | "out";
}
export interface ShipOption {
  tier: "standard" | "priority" | "express";
  name: string;
  service: string;
  cents: number;
  baseCents: number;
  free: boolean;
  estimate: string;
}
export interface Quote {
  lines: QuoteLine[];
  listSubtotalCents: number;
  qtySavingsCents: number;
  subtotalCents: number;
  discountCents: number;
  applied: { id: string; kind: string; label: string; cents: number }[];
  codeError: string;
  code: string;
  freeShipping: boolean;
  freeTiers: string[];
  freeShippingLabel: string;
  bogo: { dealId: string; variantId: string; label: string; quantity: number; cents: number }[];
  bogoCents: number;
  dealHints: { dealId: string; text: string }[];
  missing: string[];
  shipping: ShipOption[];
  shippingEstimated: boolean;
  payMethods: { id: string; name: string; blurb: string; available: boolean }[];
  /** Signed-in customer's store credit. Null when signed out. */
  credit?: { balanceCents: number; availableCents: number } | null;
  /** Local pickup / delivery for the address entered (null = not local). Never the pickup address. */
  local?: { pickup: { town: string } | null; delivery: { cents: number; feeCents: number; freeOverCents: number | null } | null; windows: string[]; payAtPickup: boolean } | null;
  /** Buyer referral discount (inside discountCents) and its label. */
  referralCents?: number;
  referralLabel?: string;
  /** A valid referral code on this cart. Never says who owns it. */
  referral?: { code: string; discountPercent: number; cents: number } | null;
  /** Why the referral code can't be used ("That is your own code..."). */
  referralError?: string;
  /** Stacking is off and both codes apply: the customer picks one. */
  conflict?: { message: string; discountCode: string; referralCode: string } | null;
  /** "You used CODE last time" (signed in, no referral code on the cart yet). */
  lastReferral?: string | null;
}

interface CartCtx {
  items: CartItem[];
  code: string;
  /** Referral code slot (one per order), separate from the discount code slot. */
  referral: string;
  setReferral: (code: string) => void;
  count: number;
  ready: boolean;
  quote: Quote | null;
  quoting: boolean;
  quoteError: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  add: (variantId: string, quantity?: number) => void;
  setQty: (variantId: string, quantity: number) => void;
  swap: (fromVariantId: string, toVariantId: string) => void;
  remove: (variantId: string) => void;
  setCode: (code: string) => void;
  clear: () => void;
  /** Re-price with a shipping address (checkout, for live rates). */
  requote: (shipTo?: Record<string, string> | null) => Promise<Quote | null>;
  products: PublicProduct[];
}

const Ctx = createContext<CartCtx | null>(null);
export const useCart = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
};

export function CartProvider({ products, children }: { products: PublicProduct[]; children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [code, setCodeState] = useState("");
  const [referral, setReferralState] = useState("");
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const seq = useRef(0);
  const shipToRef = useRef<Record<string, string> | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { items?: CartItem[]; code?: string; referral?: string };
      if (Array.isArray(saved.items)) setItems(saved.items.filter((i) => i && typeof i.variantId === "string" && i.quantity > 0));
      // "Apply now" in the promo bar links to ?code=XXXX; a friend's share link to ?ref=THEIR-CODE.
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("code");
      const refUrl = params.get("ref");
      const next = (fromUrl || saved.code || "").toUpperCase().slice(0, 30);
      if (next) setCodeState(next);
      const nextRef = cleanTyped(refUrl || saved.referral || "");
      if (nextRef) setReferralState(nextRef);
      if (fromUrl || refUrl) {
        const u = new URL(window.location.href);
        u.searchParams.delete("code");
        u.searchParams.delete("ref");
        window.history.replaceState(null, "", u.pathname + u.search);
        if (fromUrl) setOpen(true);
      }
    } catch {}
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ items, code, referral }));
    } catch {}
  }, [items, code, referral, ready]);

  const fetchQuote = useCallback(async (list: CartItem[], c: string, ref: string, shipTo: Record<string, string> | null): Promise<Quote | null> => {
    if (list.length === 0) {
      setQuote(null);
      setQuoteError("");
      return null;
    }
    const n = ++seq.current;
    setQuoting(true);
    try {
      const res = await fetch("/api/store/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: list, code: c, referralCode: ref, shipTo }) });
      const json = await res.json().catch(() => ({}));
      if (n !== seq.current) return null;
      if (!res.ok) {
        setQuoteError(json.error || "We couldn't price your cart. Check your connection and try again.");
        return null;
      }
      setQuote(json as Quote);
      setQuoteError("");
      return json as Quote;
    } catch {
      if (n === seq.current) setQuoteError("We couldn't price your cart. Check your connection and try again.");
      return null;
    } finally {
      if (n === seq.current) setQuoting(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => fetchQuote(items, code, referral, shipToRef.current), 140);
    return () => clearTimeout(t);
  }, [items, code, referral, ready, fetchQuote]);

  // Drop items the store no longer sells, once the server says so.
  useEffect(() => {
    if (quote?.missing.length) setItems((list) => list.filter((i) => !quote.missing.includes(i.variantId)));
  }, [quote]);

  const add = useCallback((variantId: string, quantity = 1) => {
    setItems((list) => {
      const i = list.findIndex((x) => x.variantId === variantId);
      if (i < 0) return [...list, { variantId, quantity: Math.min(99, quantity) }];
      return list.map((x, k) => (k === i ? { ...x, quantity: Math.min(99, x.quantity + quantity) } : x));
    });
    setOpen(true);
  }, []);
  const setQty = useCallback((variantId: string, quantity: number) => {
    setItems((list) => (quantity <= 0 ? list.filter((x) => x.variantId !== variantId) : list.map((x) => (x.variantId === variantId ? { ...x, quantity: Math.min(99, quantity) } : x))));
  }, []);
  const swap = useCallback((from: string, to: string) => {
    setItems((list) => {
      const cur = list.find((x) => x.variantId === from);
      if (!cur || from === to) return list;
      const existing = list.find((x) => x.variantId === to);
      // Keep the row where it was; merge when the other size is already in the cart.
      return list.flatMap((x) => (x.variantId === from ? [{ variantId: to, quantity: Math.min(99, cur.quantity + (existing?.quantity ?? 0)) }] : x.variantId === to ? [] : [x]));
    });
  }, []);
  const remove = useCallback((variantId: string) => setItems((list) => list.filter((x) => x.variantId !== variantId)), []);
  const clear = useCallback(() => {
    setItems([]);
    setCodeState("");
    // No lock-in: the next order starts without a referral code (a one-click "use it again" is offered).
    setReferralState("");
    setQuote(null);
  }, []);
  const setCode = useCallback((c: string) => setCodeState(c.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 30)), []);
  const setReferral = useCallback((c: string) => setReferralState(cleanTyped(c)), []);
  const requote = useCallback(
    (shipTo?: Record<string, string> | null) => {
      shipToRef.current = shipTo ?? null;
      return fetchQuote(items, code, referral, shipToRef.current);
    },
    [items, code, referral, fetchQuote],
  );

  const count = items.reduce((s, i) => s + i.quantity, 0);
  const value = useMemo(
    () => ({ items, code, referral, setReferral, count, ready, quote, quoting, quoteError, open, setOpen, add, setQty, swap, remove, setCode, clear, requote, products }),
    [items, code, referral, setReferral, count, ready, quote, quoting, quoteError, open, add, setQty, swap, remove, setCode, clear, requote, products],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <CartDrawer />
    </Ctx.Provider>
  );
}

/** Find the product and size for a cart line. */
export function useLineInfo() {
  const { products } = useCart();
  return useCallback(
    (variantId: string) => {
      for (const p of products) {
        const v = p.variants.find((x) => x.id === variantId);
        if (v) return { product: p, variant: v };
      }
      return null;
    },
    [products],
  );
}

// ---------------------------------------------------------------- Shared pieces
export function QtyStepper({ value, onChange, label, small }: { value: number; onChange: (n: number) => void; label: string; small?: boolean }) {
  const btn = `flex items-center justify-center text-stone transition hover:text-coal disabled:opacity-30 ${small ? "h-10 w-9" : "h-12 w-11"}`;
  return (
    <div className="inline-flex items-center rounded-full border border-rule" role="group" aria-label={`Quantity for ${label}`}>
      <button type="button" className={btn} aria-label="Decrease quantity" onClick={() => onChange(value - 1)}>
        <Minus size={15} />
      </button>
      <span className={`text-center text-[15px] font-medium tabular-nums ${small ? "w-6" : "w-8"}`} aria-live="polite">
        {value}
      </span>
      <button type="button" className={btn} aria-label="Increase quantity" disabled={value >= 99} onClick={() => onChange(value + 1)}>
        <Plus size={15} />
      </button>
    </div>
  );
}

export function CartLines({ compact }: { compact?: boolean }) {
  const cart = useCart();
  const info = useLineInfo();
  const lines = cart.quote?.lines ?? [];
  // Before the first price comes back, show what we know from the catalog.
  const rows = cart.items.map((it) => ({ it, line: lines.find((l) => l.variantId === it.variantId), meta: info(it.variantId) })).filter((r) => r.meta);
  return (
    <ul className="divide-y divide-rule">
      {rows.map(({ it, line, meta }) => {
        const { product, variant } = meta!;
        const unit = line?.unitPriceCents ?? variant.priceCents;
        return (
          <li key={it.variantId} className="flex gap-4 py-5">
            <Link href={`/product/${product.slug}`} onClick={() => cart.setOpen(false)} className={`shrink-0 overflow-hidden rounded-xl bg-soft ${compact ? "h-[5.5rem] w-[4.4rem]" : "h-28 w-[5.6rem]"}`}>
              {product.photos[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/media/${product.photos[0].id}-480.webp`} alt="" className="h-full w-full object-cover" />
              ) : (
                <Vial name={product.name} size={variant.label} className="h-full w-full p-1.5" />
              )}
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/product/${product.slug}`} onClick={() => cart.setOpen(false)} className="min-w-0 text-[15px] font-semibold leading-snug hover:text-brand">
                  {product.name}
                </Link>
                <div className="shrink-0 text-right text-[15px] font-semibold tabular-nums">{money(unit * it.quantity)}</div>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-stone">
                <span className="tabular-nums">{money(unit)} each</span>
                {line && line.percentOff > 0 && (
                  <>
                    <s className="tabular-nums opacity-70">{money(line.listPriceCents)}</s>
                    <span className="font-medium text-brand">{line.percentOff}% off</span>
                  </>
                )}
              </div>
              {line?.stock === "out" && <div className="mt-1 text-[13px] font-medium text-brand">Sold out. Remove this item to check out.</div>}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {product.variants.length > 1 ? (
                  <select
                    aria-label={`Size for ${product.name}`}
                    value={it.variantId}
                    onChange={(e) => cart.swap(it.variantId, e.target.value)}
                    className="h-10 rounded-full border border-rule bg-paper pl-3.5 pr-8 text-sm font-medium focus:border-coal focus:outline-none"
                  >
                    {product.variants.map((v) => (
                      <option key={v.id} value={v.id} disabled={v.stock === "out" && v.id !== it.variantId}>
                        {sizeWithVolume(v.label, v.volume)}
                        {v.stock === "out" ? " (sold out)" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  variant.label && <span data-cart-size className="s-chip h-10 px-3.5 text-sm">{sizeWithVolume(variant.label, variant.volume)}</span>
                )}
                <QtyStepper small value={it.quantity} onChange={(n) => cart.setQty(it.variantId, n)} label={product.name} />
                <button type="button" onClick={() => cart.remove(it.variantId)} className="ml-auto h-10 px-1 text-[13px] font-medium text-stone underline decoration-rule underline-offset-4 hover:text-coal">
                  Remove
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function PromoField() {
  const cart = useCart();
  const [text, setText] = useState("");
  const [openField, setOpenField] = useState(false);
  const [checking, setChecking] = useState(false);
  const [kindError, setKindError] = useState("");
  const q = cart.quote;
  const applied = q?.code;
  const ref = q?.referral ?? null;
  const settled = !!q && !cart.quoting;
  const codeErr = cart.code && settled ? q!.codeError : "";
  const refErr = cart.referral && settled ? q!.referralError ?? "" : "";
  const err = kindError || codeErr || refErr;
  const conflict = settled ? q!.conflict ?? null : null;
  useEffect(() => {
    if (err) setOpenField(true);
  }, [err]);

  // One box for both kinds: ask the server which one it is, then put it in that slot (one of each per order).
  async function apply(typed: string) {
    const value = typed.trim();
    if (!value) return;
    setChecking(true);
    setKindError("");
    try {
      const res = await fetch("/api/store/code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: value }) });
      const json = (await res.json().catch(() => ({}))) as { kind?: string; error?: string };
      if (!res.ok) throw new Error(json.error || "We couldn't check that code. Try again.");
      if (json.kind === "discount") cart.setCode(value);
      else if (json.kind === "referral") cart.setReferral(value);
      else throw new Error(json.error || "That code was not found. Check the spelling and try again.");
      setText("");
      setOpenField(false);
    } catch (e) {
      setKindError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  const chip = (label: React.ReactNode, onRemove: () => void, attr: Record<string, string>) => (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-brand-tint px-4 py-3" {...attr}>
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <Tag size={15} className="shrink-0 text-brand" />
        <span className="truncate">{label}</span>
      </span>
      <button type="button" onClick={onRemove} className="shrink-0 text-[13px] font-medium text-stone underline underline-offset-4 hover:text-coal">
        Remove
      </button>
    </div>
  );
  const both = !!applied && !!ref;

  return (
    <div className="space-y-2.5">
      {applied && chip(<>Code <strong className="font-semibold tracking-wide">{applied}</strong> applied</>, () => cart.setCode(""), { "data-applied-discount": applied })}
      {ref &&
        chip(
          <>
            Referral code <strong className="font-semibold tracking-wide">{ref.code}</strong> applied{ref.discountPercent > 0 ? ` · ${ref.discountPercent}% off` : ""}
          </>,
          () => cart.setReferral(""),
          { "data-applied-referral": ref.code },
        )}
      {conflict && (
        <div className="rounded-xl border border-brand/40 bg-paper p-4 text-sm" role="alert" data-code-conflict>
          <p className="font-medium text-coal">{conflict.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="s-btn-line h-10 px-4 text-sm" onClick={() => cart.setReferral("")}>
              Keep {conflict.discountCode}
            </button>
            <button type="button" className="s-btn-line h-10 px-4 text-sm" onClick={() => cart.setCode("")}>
              Keep referral {conflict.referralCode}
            </button>
          </div>
        </div>
      )}
      {!both && !conflict && (!openField && !err ? (
        <button type="button" onClick={() => setOpenField(true)} className="flex h-11 items-center gap-2 text-sm font-medium text-coal underline decoration-rule underline-offset-4 hover:decoration-coal">
          <Tag size={15} /> {applied || ref ? "Add another code" : "Add a discount or referral code"}
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void apply(text || (codeErr ? cart.code : refErr ? cart.referral : ""));
          }}
        >
          <label className="s-label" htmlFor="promo-code">
            Discount or referral code
          </label>
          <div className="flex gap-2">
            <input
              id="promo-code"
              className="s-input uppercase tracking-wide"
              value={text || (codeErr ? cart.code : refErr ? cart.referral : "")}
              onChange={(e) => (setText(e.target.value), setKindError(""))}
              placeholder="Enter code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={30}
              aria-describedby={err ? "promo-error" : undefined}
            />
            <button type="submit" className="s-btn-line shrink-0 px-5" disabled={checking || cart.quoting || !(text || cart.code || cart.referral).trim()}>
              {checking || cart.quoting ? "Checking…" : "Apply"}
            </button>
          </div>
          {err && (
            <p id="promo-error" className="s-error" role="alert">
              {err}{" "}
              {!kindError && (
                <button type="button" className="underline underline-offset-4" onClick={() => (codeErr ? cart.setCode("") : cart.setReferral(""), setText(""))}>
                  Clear
                </button>
              )}
            </p>
          )}
        </form>
      ))}
    </div>
  );
}

/** Signed-in buyer who used a referral code before: "You used CODE last time. Use it again?" One click applies it. */
export function LastReferralPrompt() {
  const cart = useCart();
  const last = cart.quote?.lastReferral;
  if (!last || cart.referral || cart.quote?.referral) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule px-4 py-3 text-sm" data-last-referral={last}>
      <span>
        You used <strong className="font-semibold tracking-wide">{last}</strong> last time. Use it again?
      </span>
      <button type="button" className="s-btn-line h-9 px-4 text-sm" onClick={() => cart.setReferral(last)}>
        Apply {last}
      </button>
    </div>
  );
}

/** Under the cart totals: exactly what free shipping covers (only the options the rule picked), else the plain note. */
export function ShippingNote() {
  const { quote } = useCart();
  return (
    <p data-shipping-note className="text-[13px] text-stone">
      {quote?.freeShipping ? (
        <>
          <span className="font-medium text-brand">{quote.freeShippingLabel}</span> on this order.{quote.freeShippingLabel === "Free shipping" ? "" : " Other shipping options are calculated at checkout."}
        </>
      ) : (
        "Shipping is calculated at checkout."
      )}
    </p>
  );
}

export function CartTotals({ shippingCents, shippingLabel, creditCents = 0 }: { shippingCents?: number | null; shippingLabel?: string; creditCents?: number }) {
  const { quote } = useCart();
  if (!quote) return null;
  const saved = quote.qtySavingsCents + quote.discountCents + (quote.bogoCents ?? 0);
  const total = quote.subtotalCents - quote.discountCents - creditCents + (shippingCents ?? 0);
  return (
    <dl className="space-y-2 text-[15px]">
      <div className="flex justify-between text-stone">
        <dt>Items at regular price</dt>
        <dd className="tabular-nums">{money(quote.listSubtotalCents)}</dd>
      </div>
      {quote.qtySavingsCents > 0 && (
        <div className="flex justify-between text-brand">
          <dt>Buy more, save more</dt>
          <dd className="tabular-nums">-{money(quote.qtySavingsCents)}</dd>
        </div>
      )}
      {(quote.bogo ?? []).map((b) => (
        <div key={b.dealId + b.variantId} data-bogo-row className="flex justify-between gap-4 text-brand">
          <dt className="min-w-0 truncate">{b.label}</dt>
          <dd className="shrink-0 tabular-nums">-{money(b.cents)}</dd>
        </div>
      ))}
      {quote.applied
        .filter((a) => a.cents > 0 && a.kind !== "bogo")
        .map((a) => (
          <div key={a.id} className="flex justify-between gap-4 text-brand">
            <dt className="min-w-0 truncate">{a.label}</dt>
            <dd className="shrink-0 tabular-nums">-{money(a.cents)}</dd>
          </div>
        ))}
      {(quote.referralCents ?? 0) > 0 && (
        <div data-referral-row className="flex justify-between gap-4 text-brand">
          <dt className="min-w-0 truncate">{quote.referralLabel || "Referral discount"}</dt>
          <dd className="shrink-0 tabular-nums">-{money(quote.referralCents ?? 0)}</dd>
        </div>
      )}
      {creditCents > 0 && (
        <div data-credit-row className="flex justify-between gap-4 text-brand">
          <dt>Store credit</dt>
          <dd className="shrink-0 tabular-nums">-{money(creditCents)}</dd>
        </div>
      )}
      {shippingCents !== undefined && (
        <div className="flex justify-between gap-4">
          <dt className="min-w-0 truncate">{shippingLabel?.startsWith("Local ") ? shippingLabel : `Shipping${shippingLabel ? ` (${shippingLabel})` : ""}`}</dt>
          <dd className="shrink-0 tabular-nums">{shippingCents === null ? "Calculated next" : shippingCents === 0 ? "Free" : money(shippingCents)}</dd>
        </div>
      )}
      <div data-cart-total className="flex items-baseline justify-between border-t border-rule pt-3 text-base font-semibold">
        <dt>{shippingCents === undefined || shippingCents === null ? "Subtotal" : "Total"}</dt>
        <dd className="text-xl tabular-nums">{money(total)}</dd>
      </div>
      {saved > 0 && <div className="text-right text-[13px] font-medium text-brand">You save {money(saved)}</div>}
      {(quote.dealHints ?? []).map((h) => (
        <p key={h.dealId} data-deal-hint className="rounded-lg bg-brand/10 px-3 py-2 text-[13px] font-medium text-brand">
          {h.text}
        </p>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------- Drawer
function CartDrawer() {
  const cart = useCart();
  const [mounted, setMounted] = useState(false);
  const [show, setShow] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const last = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (cart.open) {
      last.current = document.activeElement as HTMLElement;
      setMounted(true);
      requestAnimationFrame(() => setShow(true));
      document.body.style.overflow = "hidden";
      const onKey = (e: KeyboardEvent) => e.key === "Escape" && cart.setOpen(false);
      window.addEventListener("keydown", onKey);
      const t = setTimeout(() => panel.current?.focus(), 60);
      return () => {
        window.removeEventListener("keydown", onKey);
        clearTimeout(t);
        document.body.style.overflow = "";
      };
    }
    setShow(false);
    const t = setTimeout(() => setMounted(false), 320);
    last.current?.focus?.();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.open]);

  if (!mounted || typeof document === "undefined") return null;
  const empty = cart.items.length === 0;
  const blocked = cart.quote?.lines.some((l) => l.stock === "out");
  return createPortal(
    <div className="store fixed inset-0 z-[80] !bg-transparent">
      <div className={`absolute inset-0 bg-night/45 transition-opacity duration-300 ${show ? "opacity-100" : "opacity-0"}`} onClick={() => cart.setOpen(false)} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Your cart"
        tabIndex={-1}
        className={`absolute inset-y-0 right-0 flex w-full max-w-[27rem] flex-col bg-paper shadow-2xl outline-none transition-transform duration-[420ms] ease-out ${show ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-rule px-5">
          <h2 className="text-lg font-semibold tracking-tight">
            Your cart{cart.count > 0 && <span className="ml-2 text-sm font-normal text-stone">{cart.count} {cart.count === 1 ? "item" : "items"}</span>}
          </h2>
          <button type="button" aria-label="Close cart" onClick={() => cart.setOpen(false)} className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-stone hover:bg-soft hover:text-coal">
            <X size={20} />
          </button>
        </div>
        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <ShoppingBag size={30} className="text-rule" strokeWidth={1.5} />
            <p className="mt-4 text-lg font-semibold">Your cart is empty</p>
            <p className="mt-1 text-[15px] text-stone">Browse the catalog and add what you need.</p>
            <Link href="/shop" onClick={() => cart.setOpen(false)} className="s-btn-primary mt-6">
              Shop all products
            </Link>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
              <CartLines compact />
            </div>
            <div className="shrink-0 space-y-4 border-t border-rule bg-paper px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4">
              <PromoField />
              {cart.quoteError ? (
                <p className="s-error" role="alert">
                  {cart.quoteError}
                </p>
              ) : cart.quote ? (
                <CartTotals />
              ) : (
                <div className="h-16 animate-pulse rounded-xl bg-soft" />
              )}
              <ShippingNote />
              <div className="grid grid-cols-2 gap-2.5">
                <Link href="/cart" onClick={() => cart.setOpen(false)} className="s-btn-line">
                  View cart
                </Link>
                <Link href="/checkout" onClick={() => cart.setOpen(false)} aria-disabled={blocked} className={`s-btn-primary ${blocked ? "pointer-events-none opacity-45" : ""}`}>
                  Checkout
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
