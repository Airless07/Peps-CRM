// Cart pricing. Pure: catalog + promotions in, every number the checkout shows out.
// The same function prices the cart drawer, the checkout page and the order that is saved,
// so they can never disagree.
import { discountAmount } from "../money";
import type { PromotionRec, QtyDeal } from "../types";
import type { ShippingTierId, StoreSettings } from "./config";

export interface PricedVariant {
  variantId: string;
  listingId: string;
  groupIds: string[];
  name: string;
  priceCents: number;
  /** Tiers that apply to this product (already resolved: product override or store default). */
  qtyDeals: QtyDeal[];
}

export interface CartItemInput {
  variantId: string;
  quantity: number;
}

export interface PricedLine {
  variantId: string;
  listingId: string;
  name: string;
  quantity: number;
  /** Regular price each. */
  listPriceCents: number;
  /** Price each after "buy more, save more". This is what the order line stores. */
  unitPriceCents: number;
  percentOff: number;
  lineTotalCents: number;
}

export interface CartPricing {
  lines: PricedLine[];
  /** Sum of regular prices. */
  listSubtotalCents: number;
  /** Saved through buy more, save more. */
  qtySavingsCents: number;
  /** Subtotal after quantity savings: the order's subtotal. */
  subtotalCents: number;
  /** Discount from a code and/or an automatic deal (an order-level "$" discount). */
  discountCents: number;
  /** Promotions that were applied (code, automatic deal, free shipping rule). */
  applied: { id: string; kind: PromotionRec["kind"]; label: string; cents: number }[];
  /** Why the typed code was not applied, in plain words. Empty when fine or no code. */
  codeError: string;
  code: string;
  /** A free shipping rule matched this cart (which tiers it covers is a store setting). */
  freeShipping: boolean;
  freeShippingLabel: string;
}

/** The percent off for a quantity: the highest tier whose minimum is met. */
export function qtyPercentOff(deals: QtyDeal[], quantity: number): number {
  let best = 0;
  for (const d of deals) if (quantity >= d.minQty && d.percentOff > best) best = d.percentOff;
  return best;
}

/** Unit price after a percent off, rounded to the cent (never below 0). */
export const discountedUnit = (priceCents: number, percentOff: number) => Math.max(0, Math.round((priceCents * (100 - percentOff)) / 100));

const t = (iso: string | null) => (iso ? new Date(iso).getTime() : null);

export function isLive(p: Pick<PromotionRec, "active" | "startsAt" | "endsAt">, now: Date): boolean {
  if (!p.active) return false;
  const n = now.getTime();
  const s = t(p.startsAt);
  const e = t(p.endsAt);
  return (s === null || n >= s) && (e === null || n <= e);
}

export const usesLeft = (p: Pick<PromotionRec, "maxUses" | "uses">): number | null => (p.maxUses === null ? null : Math.max(0, p.maxUses - p.uses.length));

/** Subtotal of the lines a promotion applies to (all lines when it has no product/group limit). */
function eligibleSubtotal(p: PromotionRec, lines: PricedLine[], variants: Map<string, PricedVariant>): number {
  const limited = p.listingIds.length > 0 || p.groupIds.length > 0;
  return lines.reduce((sum, l) => {
    if (!limited) return sum + l.lineTotalCents;
    const v = variants.get(l.variantId);
    const hit = p.listingIds.includes(l.listingId) || (v?.groupIds ?? []).some((g) => p.groupIds.includes(g));
    return hit ? sum + l.lineTotalCents : sum;
  }, 0);
}

const money = (c: number) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
export const promoValueLabel = (p: Pick<PromotionRec, "discountType" | "discountValue">) =>
  p.discountType === "%" ? `${p.discountValue}% off` : `${money(p.discountValue)} off`;

/**
 * Why a promotion can't be used right now ("" = usable).
 * `email` is only needed for one-use-per-email codes.
 */
export function promoBlock(p: PromotionRec, eligibleCents: number, now: Date, email: string): string {
  if (!p.active) return "This code is not active.";
  const s = t(p.startsAt);
  const e = t(p.endsAt);
  if (s !== null && now.getTime() < s) return "This code is not active yet.";
  if (e !== null && now.getTime() > e) return "This code has expired.";
  if (usesLeft(p) === 0) return "This code has been fully used.";
  if (p.oncePerEmail && email && p.uses.some((u) => u.email.toLowerCase() === email.toLowerCase())) return "This code was already used with this email.";
  if (eligibleCents <= 0) return "This code does not apply to the items in your cart.";
  if (p.minSubtotalCents > 0 && eligibleCents < p.minSubtotalCents) return `This code needs a subtotal of at least ${money(p.minSubtotalCents)}.`;
  return "";
}

export function priceCart(input: {
  items: CartItemInput[];
  variants: PricedVariant[];
  promotions: PromotionRec[];
  code?: string;
  email?: string;
  now?: Date;
}): CartPricing {
  const now = input.now ?? new Date();
  const email = (input.email ?? "").trim();
  const byId = new Map(input.variants.map((v) => [v.variantId, v]));

  // Merge duplicate rows and drop anything that is not a real, positive quantity.
  const qty = new Map<string, number>();
  for (const it of input.items) {
    const q = Math.floor(Number(it.quantity));
    if (!byId.has(it.variantId) || !(q > 0)) continue;
    qty.set(it.variantId, Math.min(999, (qty.get(it.variantId) ?? 0) + q));
  }

  // Buy more, save more counts every size of the same product together.
  const perListing = new Map<string, number>();
  for (const [id, q] of qty) {
    const v = byId.get(id)!;
    perListing.set(v.listingId, (perListing.get(v.listingId) ?? 0) + q);
  }

  const lines: PricedLine[] = [];
  for (const [id, q] of qty) {
    const v = byId.get(id)!;
    const percentOff = qtyPercentOff(v.qtyDeals, perListing.get(v.listingId) ?? q);
    const unit = discountedUnit(v.priceCents, percentOff);
    lines.push({ variantId: id, listingId: v.listingId, name: v.name, quantity: q, listPriceCents: v.priceCents, unitPriceCents: unit, percentOff, lineTotalCents: unit * q });
  }
  const listSubtotalCents = lines.reduce((s, l) => s + l.listPriceCents * l.quantity, 0);
  const subtotalCents = lines.reduce((s, l) => s + l.lineTotalCents, 0);

  const applied: CartPricing["applied"] = [];
  let remaining = subtotalCents;
  let codeError = "";
  let usedCode = "";

  // 1. Discount code (one per order).
  const typed = (input.code ?? "").trim().toUpperCase();
  if (typed) {
    const p = input.promotions.find((x) => x.kind === "code" && x.code.toUpperCase() === typed);
    if (!p) codeError = "That code was not found. Check the spelling and try again.";
    else {
      const eligible = eligibleSubtotal(p, lines, byId);
      codeError = promoBlock(p, eligible, now, email);
      if (!codeError) {
        const cents = Math.min(remaining, discountAmount(p.discountType, p.discountValue, eligible));
        if (cents > 0) {
          applied.push({ id: p.id, kind: "code", label: `${p.code}: ${promoValueLabel(p)}`, cents });
          remaining -= cents;
          usedCode = p.code;
        }
      }
    }
  }

  // 2. Automatic deals (no code). The best single one applies, on top of a code.
  let bestAuto: { p: PromotionRec; cents: number } | null = null;
  for (const p of input.promotions) {
    if (p.kind !== "auto") continue;
    const eligible = eligibleSubtotal(p, lines, byId);
    if (promoBlock(p, eligible, now, email)) continue;
    const cents = Math.min(remaining, discountAmount(p.discountType, p.discountValue, eligible));
    if (cents > 0 && (!bestAuto || cents > bestAuto.cents)) bestAuto = { p, cents };
  }
  if (bestAuto) {
    applied.push({ id: bestAuto.p.id, kind: "auto", label: `${bestAuto.p.name || "Deal"}: ${promoValueLabel(bestAuto.p)}`, cents: bestAuto.cents });
    remaining -= bestAuto.cents;
  }

  // 3. Free shipping rules: date range + optional minimum, checked against the subtotal after discounts.
  let freeShipping = false;
  let freeShippingLabel = "";
  for (const p of input.promotions) {
    if (p.kind !== "free_shipping" || !isLive(p, now) || usesLeft(p) === 0) continue;
    if (lines.length > 0 && remaining >= p.minSubtotalCents) {
      freeShipping = true;
      freeShippingLabel = p.name || "Free shipping";
      applied.push({ id: p.id, kind: "free_shipping", label: freeShippingLabel, cents: 0 });
      break;
    }
  }

  return {
    lines,
    listSubtotalCents,
    qtySavingsCents: listSubtotalCents - subtotalCents,
    subtotalCents,
    discountCents: subtotalCents - remaining,
    applied,
    codeError,
    code: usedCode,
    freeShipping,
    freeShippingLabel,
  };
}

// ---------------------------------------------------------------- Shipping
export interface ShippingOption {
  tier: ShippingTierId;
  name: string;
  /** Carrier service shown under the name. */
  service: string;
  /** What the customer pays (0 when free shipping covers this tier). */
  cents: number;
  /** What it would cost without free shipping. */
  baseCents: number;
  free: boolean;
  estimate: string;
}

/**
 * Shipping options for a cart. `liveCents` holds live carrier prices per tier when the store uses
 * live rates and a lookup succeeded; any tier missing from it falls back to its flat price.
 */
export function shippingOptions(
  store: Pick<StoreSettings, "shippingTiers" | "freeShippingTiers">,
  freeShipping: boolean,
  live?: Partial<Record<ShippingTierId, { cents: number; service: string; estimate: string }>>,
): ShippingOption[] {
  return store.shippingTiers
    .filter((tier) => tier.enabled)
    .map((tier) => {
      const l = live?.[tier.id];
      const baseCents = Math.max(0, l ? l.cents : tier.flatCents);
      const free = freeShipping && store.freeShippingTiers.includes(tier.id);
      return { tier: tier.id, name: tier.name, service: l?.service ?? "", cents: free ? 0 : baseCents, baseCents, free, estimate: l?.estimate ?? "" };
    });
}

/** Text for the announcement bar generated from what is live right now. Empty when nothing is. */
export function promoHeadlines(promotions: PromotionRec[], now = new Date()): { text: string; code: string }[] {
  const out: { text: string; code: string }[] = [];
  for (const p of promotions) {
    if (!isLive(p, now)) continue;
    const left = usesLeft(p);
    if (left === 0) continue;
    const min = p.minSubtotalCents > 0 ? ` on orders ${money(p.minSubtotalCents)}+` : "";
    if (p.kind === "free_shipping") out.push({ text: `Free shipping${min}`, code: "" });
    else if (p.kind === "auto") out.push({ text: `${promoValueLabel(p)}${min}${left !== null ? `: ${left} left` : ""}`, code: "" });
    else if (p.kind === "code" && p.listingIds.length === 0 && p.groupIds.length === 0 && !p.oncePerEmail && left === null) {
      // Only open, unlimited codes are advertised automatically.
      out.push({ text: `${promoValueLabel(p)}${min} with code`, code: p.code });
    }
  }
  return out;
}
