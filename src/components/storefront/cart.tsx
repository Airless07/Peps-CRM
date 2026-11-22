"use client";

// Cart state for the store. Every account has its own cart:
//  - signed in: the cart lives on the server (CustomerCart), tied to the account, so it follows the
//    account to any device and no other account ever sees it;
//  - guest: the cart lives in this browser under GUEST_KEY.
// Signing in adds the guest cart to the account's cart (codes are not carried over). Signing out clears
// everything local. Every price comes from the server (/api/store/quote) for whoever is signed in NOW,
// so the drawer, the cart page and checkout always agree and nothing priced in the browser is trusted.
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, ShoppingBag, Tag, X } from "lucide-react";
import { sizeWithVolume } from "@/lib/size";
import type { PublicProduct } from "@/lib/store/catalog";
import { Vial } from "./vial";

export const money = (c: number) => `$${(c / 100).toFixed(2)}`;
/** The guest cart (signed out). Never holds a signed-in account's cart. */
export const GUEST_KEY = "bp-cart:guest";
/** Before carts were per account, one cart for everybody in the browser lived here. Read once as a guest, then removed. */
const LEGACY_KEY = "bp-cart";
const CHANNEL = "bp-account";
const EVENT = "bp-account-change";
/** A typed code as kept in the cart: letters, numbers, dashes and underscores, as typed (the server ignores case). */
const cleanTyped = (c: string) => c.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 30);

/**
 * Tell the cart (this tab and other tabs) who is signed in now. Called right after sign in / sign up /
 * claim / reset (with the account id) and sign out (null), so the cart switches immediately instead of
 * after the page reloads.
 */
export function announceAccount(id: string | null) {
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { id } }));
  } catch {}
  try {
    const c = new BroadcastChannel(CHANNEL);
    c.postMessage({ id });
    c.close();
  } catch {}
}

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
  /** Account the server priced this for (null = guest). */
  accountId?: string | null;
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

export type AddOutcome = { ok: boolean; added: number; message: string };

interface CartCtx {
  /** Who this cart belongs to: an account id, or null for the guest cart. */
  owner: string | null;
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
  /** Add with a stock check on the server (quick add). Opens the drawer when something was added. */
  addChecked: (variantId: string, quantity: number) => Promise<AddOutcome>;
  setQty: (variantId: string, quantity: number) => void;
  swap: (fromVariantId: string, toVariantId: string) => void;
  remove: (variantId: string) => void;
  setCode: (code: string) => void;
  clear: () => void;
  /** Check a typed code (discount or referral) for THIS account and only keep it when it works. */
  applyCode: (typed: string) => Promise<{ ok: boolean; error: string }>;
  /** "You used CODE last time" was answered (Yes or No): don't offer it again in this checkout. */
  lastPromptDone: boolean;
  setLastPromptDone: (v: boolean) => void;
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

const validItems = (list: unknown): CartItem[] =>
  Array.isArray(list) ? list.filter((i): i is CartItem => !!i && typeof i.variantId === "string" && Number.isInteger(i.quantity) && i.quantity > 0).map((i) => ({ variantId: i.variantId, quantity: Math.min(99, i.quantity) })) : [];

function readGuest(): { items: CartItem[]; code: string; referral: string } {
  try {
    let raw = localStorage.getItem(GUEST_KEY);
    // One-time move of the old shared cart, only ever into the GUEST cart.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy !== null) {
      if (raw === null) raw = legacy;
      localStorage.removeItem(LEGACY_KEY);
    }
    const saved = JSON.parse(raw ?? "{}") as { items?: unknown; code?: string; referral?: string };
    return { items: validItems(saved.items), code: typeof saved.code === "string" ? saved.code : "", referral: typeof saved.referral === "string" ? saved.referral : "" };
  } catch {
    return { items: [], code: "", referral: "" };
  }
}
function clearLocal() {
  try {
    localStorage.removeItem(GUEST_KEY);
    localStorage.removeItem(LEGACY_KEY);
    sessionStorage.removeItem("bl-checkout");
  } catch {}
}
async function cartApi(body: Record<string, unknown>) {
  const res = await fetch("/api/store/cart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  return { res, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export function CartProvider({ products, accountId = null, children }: { products: PublicProduct[]; accountId?: string | null; children: React.ReactNode }) {
  const [owner, setOwner] = useState<string | null>(accountId);
  const [items, setItems] = useState<CartItem[]>([]);
  const [code, setCodeState] = useState("");
  const [referral, setReferralState] = useState("");
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [lastPromptDone, setLastPromptDone] = useState(false);
  const seq = useRef(0);
  const shipToRef = useRef<Record<string, string> | null>(null);
  // Who the cart on screen belongs to, and a generation number: any answer that arrives after the
  // account changed belongs to the old account and is thrown away.
  const ownerRef = useRef<string | null>(accountId);
  const gen = useRef(0);
  const itemsRef = useRef<CartItem[]>([]);
  itemsRef.current = items;
  const savedRef = useRef("");
  const urlDone = useRef(false);

  /** Show the cart of `next` (null = guest). Everything of the previous account is wiped first. */
  const load = useCallback(async (next: string | null, mergeGuest: CartItem[] | null) => {
    const g = ++gen.current;
    ownerRef.current = next;
    seq.current++; // drop any price on its way for the previous account
    setOwner(next);
    setItems([]);
    setCodeState("");
    setReferralState("");
    setQuote(null);
    setQuoteError("");
    setQuoting(false);
    setLastPromptDone(false);
    setReady(false);
    shipToRef.current = null;
    let loaded = { items: [] as CartItem[], code: "", referral: "" };
    if (next === null) {
      loaded = readGuest();
    } else {
      try {
        const { res, json } = mergeGuest?.length
          ? await cartApi({ action: "merge", accountId: next, items: mergeGuest })
          : await fetch("/api/store/cart", { cache: "no-store" }).then(async (r) => ({ res: r, json: (await r.json().catch(() => ({}))) as Record<string, unknown> }));
        if (g !== gen.current) return;
        const now = (json.accountId as string | null | undefined) ?? null;
        if (now !== next) {
          // Signed in as someone else (or signed out) by now: load that one instead.
          void load(now, null);
          return;
        }
        if (res.ok) {
          loaded = { items: validItems(json.items), code: String(json.code ?? ""), referral: String(json.referral ?? "") };
          // The guest cart is now part of the account's cart: the browser copy goes.
          if (mergeGuest) clearLocal();
        }
      } catch {}
    }
    if (g !== gen.current) return;
    setItems(loaded.items);
    setCodeState(loaded.code);
    setReferralState(loaded.referral);
    savedRef.current = JSON.stringify(loaded);
    setReady(true);
  }, []);

  /** The signed-in account changed (sign in, sign out, another tab, or the page reloaded with a new session). */
  const switchTo = useCallback(
    (next: string | null) => {
      if (next === ownerRef.current) return;
      const prev = ownerRef.current;
      if (next === null) {
        // Signed out: nothing of the account stays in this browser. A fresh, empty guest cart.
        clearLocal();
        void load(null, null);
        return;
      }
      // Guest -> account: the guest's items go into the account's cart. Account -> another account: nothing carries over.
      const guest = prev === null ? (itemsRef.current.length ? itemsRef.current : readGuest().items) : null;
      if (prev !== null) clearLocal();
      void load(next, guest);
    },
    [load],
  );

  // First load, and whenever the server-rendered session changes (router.refresh after sign in / out).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (accountId !== null) {
        // Signed in: the old shared browser cart may belong to anyone. It is not used for this account.
        try {
          localStorage.removeItem(LEGACY_KEY);
        } catch {}
      }
      void load(accountId, null);
      return;
    }
    switchTo(accountId);
  }, [accountId, load, switchTo]);

  // Sign in / out in this tab (instant), in another tab (BroadcastChannel), or anywhere (checked when the tab is shown again).
  useEffect(() => {
    const onEvent = (e: Event) => switchTo(((e as CustomEvent).detail?.id as string | null) ?? null);
    window.addEventListener(EVENT, onEvent);
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(CHANNEL);
      ch.onmessage = (m) => switchTo((m.data?.id as string | null) ?? null);
    } catch {}
    const probe = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/store/cart", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          const now = (j?.accountId as string | null | undefined) ?? null;
          if (now !== ownerRef.current) switchTo(now);
        })
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", probe);
    window.addEventListener("focus", probe);
    return () => {
      window.removeEventListener(EVENT, onEvent);
      ch?.close();
      document.removeEventListener("visibilitychange", probe);
      window.removeEventListener("focus", probe);
    };
  }, [switchTo]);

  // "Apply now" in the promo bar links to ?code=XXXX; a friend's share link to ?ref=THEIR-CODE. Read once, into whichever cart is loaded.
  useEffect(() => {
    if (!ready || urlDone.current) return;
    urlDone.current = true;
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("code");
      const refUrl = params.get("ref");
      if (fromUrl) setCodeState(fromUrl.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 30));
      if (refUrl) setReferralState(cleanTyped(refUrl));
      if (fromUrl || refUrl) {
        const u = new URL(window.location.href);
        u.searchParams.delete("code");
        u.searchParams.delete("ref");
        window.history.replaceState(null, "", u.pathname + u.search);
        if (fromUrl) setOpen(true);
      }
    } catch {}
  }, [ready]);

  // Save: guest -> this browser; signed in -> the account on the server (debounced). The account id goes
  // with every save and the server refuses it when the session is someone else's.
  useEffect(() => {
    if (!ready) return;
    const snap = JSON.stringify({ items, code, referral });
    if (snap === savedRef.current) return;
    const who = owner;
    if (who === null) {
      savedRef.current = snap;
      try {
        localStorage.setItem(GUEST_KEY, snap);
      } catch {}
      return;
    }
    const g = gen.current;
    const t = setTimeout(async () => {
      try {
        const { res, json } = await cartApi({ action: "save", accountId: who, items, code, referral });
        if (g !== gen.current) return;
        if (res.ok) savedRef.current = snap;
        else if (res.status === 409 && json.accountChanged) switchTo((json.accountId as string | null) ?? null);
        else if (res.status === 401) switchTo(null);
      } catch {}
    }, 350);
    return () => clearTimeout(t);
  }, [items, code, referral, ready, owner, switchTo]);

  const fetchQuote = useCallback(
    async (list: CartItem[], c: string, ref: string, shipTo: Record<string, string> | null): Promise<Quote | null> => {
      if (list.length === 0) {
        setQuote(null);
        setQuoteError("");
        return null;
      }
      const n = ++seq.current;
      setQuoting(true);
      try {
        const res = await fetch("/api/store/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: list, code: c, referralCode: ref, shipTo }), cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (n !== seq.current) return null;
        if (!res.ok) {
          setQuoteError(json.error || "We couldn't price your cart. Check your connection and try again.");
          return null;
        }
        // Priced for a different session than the cart on screen: switch carts, never show this price.
        if ("accountId" in json && (json.accountId ?? null) !== ownerRef.current) {
          switchTo(json.accountId ?? null);
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
    },
    [switchTo],
  );

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
  const addChecked = useCallback(
    async (variantId: string, quantity: number): Promise<AddOutcome> => {
      const who = ownerRef.current;
      const g = gen.current;
      try {
        const { res, json } = await cartApi({ action: "add", accountId: who, variantId, quantity, items: itemsRef.current });
        if (g !== gen.current) return { ok: false, added: 0, message: "Your account changed. Try again." };
        if (res.status === 409 && json.accountChanged) {
          switchTo((json.accountId as string | null) ?? null);
          return { ok: false, added: 0, message: "Your account changed. Try again." };
        }
        if (!res.ok) return { ok: false, added: 0, message: String(json.error || "We couldn't add that. Try again.") };
        const added = Number(json.added ?? 0);
        if (added > 0) {
          const next = validItems(json.items);
          // Signed in: the server already saved it.
          if (who !== null) savedRef.current = JSON.stringify({ items: next, code, referral });
          setItems(next);
          setOpen(true);
        }
        return { ok: added > 0, added, message: String(json.message ?? "") };
      } catch {
        return { ok: false, added: 0, message: "We couldn't add that. Check your connection and try again." };
      }
    },
    [code, referral, switchTo],
  );
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
    setLastPromptDone(false);
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

  /**
   * One box takes both kinds of code. The server says which kind it is, then the cart is priced WITH the
   * code for this account; only a code that works is put in its slot. A code that doesn't work never
   * enters the cart, so nothing can type itself back into the box later.
   */
  const applyCode = useCallback(
    async (typed: string): Promise<{ ok: boolean; error: string }> => {
      const value = cleanTyped(typed);
      if (!value) return { ok: false, error: "Enter a code." };
      const g = gen.current;
      try {
        const res = await fetch("/api/store/code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: value }), cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { kind?: string; error?: string };
        if (!res.ok) return { ok: false, error: json.error || "We couldn't check that code. Try again." };
        if (json.kind !== "discount" && json.kind !== "referral") return { ok: false, error: json.error || "That code was not found. Check the spelling and try again." };
        const nextCode = json.kind === "discount" ? value.toUpperCase() : code;
        const nextRef = json.kind === "referral" ? value : referral;
        const tr = await fetch("/api/store/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: itemsRef.current, code: nextCode, referralCode: nextRef, shipTo: shipToRef.current }), cache: "no-store" });
        const q = (await tr.json().catch(() => ({}))) as Partial<Quote> & { error?: string };
        if (g !== gen.current) return { ok: false, error: "Your account changed. Enter the code again." };
        if (!tr.ok) return { ok: false, error: q.error || "We couldn't check that code. Try again." };
        const err = json.kind === "discount" ? q.codeError ?? "" : q.referralError ?? "";
        if (err) return { ok: false, error: err };
        if (json.kind === "discount") setCode(value);
        else setReferral(value);
        return { ok: true, error: "" };
      } catch {
        return { ok: false, error: "We couldn't check that code. Check your connection and try again." };
      }
    },
    [code, referral, setCode, setReferral],
  );

  const count = items.reduce((s, i) => s + i.quantity, 0);
  const value = useMemo(
    () => ({ owner, items, code, referral, setReferral, count, ready, quote, quoting, quoteError, open, setOpen, add, addChecked, setQty, swap, remove, setCode, clear, applyCode, lastPromptDone, setLastPromptDone, requote, products }),
    [owner, items, code, referral, setReferral, count, ready, quote, quoting, quoteError, open, add, addChecked, setQty, swap, remove, setCode, clear, applyCode, lastPromptDone, requote, products],
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

/**
 * The one code box (discount or referral code). The box shows exactly what the customer typed and nothing
 * else: it is never filled in by the cart, so a deleted code stays deleted. A code is applied only when it
 * works for this account; otherwise the box keeps what was typed and says why.
 * `offerLast` (checkout): "You used code CODE last time. Use it again?" under the box, with Yes / No.
 */
export function PromoField({ offerLast = false }: { offerLast?: boolean }) {
  const cart = useCart();
  const [text, setText] = useState("");
  const [openField, setOpenField] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const q = cart.quote;
  const applied = q?.code;
  const ref = q?.referral ?? null;
  const settled = !!q && !cart.quoting;
  // A code that was applied but stopped working (an item was removed, the code ended...): said under the chips, never put back in the box.
  const staleCode = cart.code && settled && q!.codeError ? { code: cart.code, error: q!.codeError, clear: () => cart.setCode("") } : null;
  const staleRef = cart.referral && settled && q!.referralError ? { code: cart.referral, error: q!.referralError, clear: () => cart.setReferral("") } : null;
  const conflict = settled ? q!.conflict ?? null : null;

  async function apply(typed: string) {
    if (!typed.trim()) return;
    setChecking(true);
    setError("");
    const r = await cart.applyCode(typed);
    setChecking(false);
    if (r.ok) {
      setText("");
      setOpenField(false);
    } else {
      setError(r.error);
      setOpenField(true);
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
  // Last time's referral code: signed in, the server says it still exists and is not theirs, no referral code on this order, not answered yet.
  const last = offerLast && cart.owner && !cart.lastPromptDone && !cart.referral && !ref && !conflict ? q?.lastReferral ?? null : null;

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
      {[staleCode, staleRef].map(
        (x) =>
          x && (
            <p key={x.code} className="s-error flex flex-wrap items-center gap-x-2" role="alert" data-stale-code={x.code}>
              <span>
                <strong className="font-semibold">{x.code}</strong>: {x.error}
              </span>
              <button type="button" className="underline underline-offset-4" onClick={x.clear}>
                Remove
              </button>
            </p>
          ),
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
      {!both && !conflict && (!openField ? (
        <button type="button" onClick={() => setOpenField(true)} className="flex h-11 items-center gap-2 text-sm font-medium text-coal underline decoration-rule underline-offset-4 hover:decoration-coal">
          <Tag size={15} /> {applied || ref ? "Add another code" : "Add a discount or referral code"}
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void apply(text);
          }}
        >
          <label className="s-label" htmlFor="promo-code">
            Discount or referral code
          </label>
          <div className="flex gap-2">
            <input
              id="promo-code"
              className="s-input uppercase tracking-wide"
              value={text}
              onChange={(e) => (setText(e.target.value), setError(""))}
              placeholder="Enter code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={30}
              aria-invalid={!!error}
              aria-describedby={error ? "promo-error" : undefined}
            />
            <button type="submit" className="s-btn-line shrink-0 px-5" disabled={checking || !text.trim()}>
              {checking ? "Checking…" : "Apply"}
            </button>
          </div>
          {error && (
            <p id="promo-error" className="s-error" role="alert">
              {error}
            </p>
          )}
        </form>
      ))}
      {last && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-stone" data-last-referral={last}>
          <span>
            You used code <strong className="font-semibold tracking-wide text-coal">{last}</strong> last time. Use it again?
          </span>
          <span className="flex gap-1.5">
            <button
              type="button"
              data-last-referral-yes
              className="h-8 rounded-full border border-coal px-3 font-medium text-coal transition hover:bg-coal hover:text-white"
              onClick={() => {
                cart.setLastPromptDone(true);
                void apply(last);
              }}
            >
              Yes
            </button>
            <button type="button" data-last-referral-no className="h-8 rounded-full border border-rule px-3 font-medium text-stone transition hover:border-coal hover:text-coal" onClick={() => cart.setLastPromptDone(true)}>
              No
            </button>
          </span>
        </div>
      )}
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
