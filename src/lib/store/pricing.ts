// Cart pricing. Pure: catalog + promotions in, every number the checkout shows out.
// The same function prices the cart drawer, the checkout page and the order that is saved,
// so they can never disagree.
import { dealHints, dealText, liveDeals, pickDeals, type DealPlan, type DealSource } from "../bogo";
import { discountAmount } from "../money";
import type { PromotionRec, QtyDeal } from "../types";
import type { ShippingTier, ShippingTierId, StoreSettings } from "./config";

export interface PricedVariant {
  variantId: string;
  listingId: string;
  groupIds: string[];
  name: string;
  priceCents: number;
  /** Tiers that apply to this product (already resolved: product override or store default). */
  qtyDeals: QtyDeal[];
  /** The parent product's name (for BOGO wording). */
  listingName?: string;
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

export interface BogoRow {
  dealId: string;
  dealName: string;
  variantId: string;
  /** "BOGO: GHK-Cu 100mg" */
  label: string;
  /** Discounted units. */
  quantity: number;
  /** Regular price each. */
  fullPriceCents: number;
  /** Price each of the discounted units. */
  unitPriceCents: number;
  /** Total taken off. */
  cents: number;
}

export interface CartPricing {
  lines: PricedLine[];
  /** Sum of regular prices. */
  listSubtotalCents: number;
  /** Saved through buy more, save more. */
  qtySavingsCents: number;
  /** Subtotal after quantity savings and BOGO deals: the order's subtotal. */
  subtotalCents: number;
  /** BOGO deals used, one row per discounted size: "BOGO: GHK-Cu 100mg", -$55.00. */
  bogo: BogoRow[];
  /** Taken off by BOGO deals (already inside subtotalCents). */
  bogoCents: number;
  /** "Add 1 more GHK-Cu to get it free". */
  dealHints: { dealId: string; text: string }[];
  /** Discount from a code and/or an automatic deal (an order-level "$" discount). */
  discountCents: number;
  /** Promotions that were applied (code, automatic deal, free shipping rule). */
  applied: { id: string; kind: PromotionRec["kind"]; label: string; cents: number }[];
  /** Why the typed code was not applied, in plain words. Empty when fine or no code. */
  codeError: string;
  code: string;
  /** At least one free shipping rule matched this cart. */
  freeShipping: boolean;
  /** The shipping options the matched rules make free (each rule picks its own). */
  freeTiers: ShippingTierId[];
  /** Exactly what is free, e.g. "Free standard shipping". */
  freeShippingLabel: string;
}

const TIER_ORDER: ShippingTierId[] = ["standard", "priority", "express"];
const TIER_WORD: Record<ShippingTierId, string> = { standard: "Standard", priority: "Priority", express: "Express" };

/**
 * Says exactly what a free shipping rule covers, with the option names from Settings:
 * "Free standard shipping", "Free standard and priority shipping", or "Free shipping" when it
 * covers every option the store offers.
 */
export function freeShippingText(tiers: ShippingTierId[], options?: Pick<ShippingTier, "id" | "name" | "enabled">[]): string {
  const offered = options ? options.filter((o) => o.enabled).map((o) => o.id) : TIER_ORDER;
  const covered = TIER_ORDER.filter((t) => tiers.includes(t) && offered.includes(t));
  if (covered.length === 0) return "Free shipping";
  if (offered.length > 0 && offered.every((t) => covered.includes(t)) && offered.length > 1) return "Free shipping";
  const name = (t: ShippingTierId) => (options?.find((o) => o.id === t)?.name.trim() || TIER_WORD[t]).replace(/\s*shipping$/i, "").toLowerCase();
  const names = covered.map(name);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Free ${list} shipping`;
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
  /** The store's shipping options, so free shipping text uses their current names. */
  shippingTiers?: Pick<ShippingTier, "id" | "name" | "enabled">[];
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

  // BOGO deals. A product uses either its BOGO deal or buy-more savings, never both on the same units:
  // a deal is only used when it makes the cart cheaper than the quantity tiers would.
  const deals = liveDeals(input.promotions, now, "online");
  const sources: DealSource[] = [...qty].map(([id, q]) => ({ key: id, variantId: id, listingId: byId.get(id)!.listingId, unitCents: byId.get(id)!.priceCents, qty: q }));
  const cartPrice = (plans: DealPlan[]) => {
    const onDeal = new Set(plans.flatMap((p) => [...p.listings]));
    let sum = 0;
    for (const [id, q] of qty) {
      const v = byId.get(id)!;
      sum += (onDeal.has(v.listingId) ? v.priceCents : discountedUnit(v.priceCents, qtyPercentOff(v.qtyDeals, perListing.get(v.listingId) ?? q))) * q;
    }
    return sum - plans.reduce((x, p) => x + p.cents, 0);
  };
  const plans = deals.length ? pickDeals(deals, sources, (p, chosen) => cartPrice([...chosen, p]) < cartPrice(chosen)) : [];
  const dealListings = new Set(plans.flatMap((p) => [...p.listings]));

  const lines: PricedLine[] = [];
  for (const [id, q] of qty) {
    const v = byId.get(id)!;
    const percentOff = dealListings.has(v.listingId) ? 0 : qtyPercentOff(v.qtyDeals, perListing.get(v.listingId) ?? q);
    const unit = discountedUnit(v.priceCents, percentOff);
    lines.push({ variantId: id, listingId: v.listingId, name: v.name, quantity: q, listPriceCents: v.priceCents, unitPriceCents: unit, percentOff, lineTotalCents: unit * q });
  }
  const bogo: BogoRow[] = [];
  for (const p of plans) {
    for (const [vid, g] of p.gets) {
      const v = byId.get(vid)!;
      bogo.push({ dealId: p.deal.id, dealName: p.deal.name.trim() || "BOGO", variantId: vid, label: `BOGO: ${v.name}`, quantity: g.qty, fullPriceCents: v.priceCents, unitPriceCents: v.priceCents - g.offEachCents, cents: g.qty * g.offEachCents });
    }
  }
  const bogoCents = bogo.reduce((s, b) => s + b.cents, 0);
  const bogoOn = (vid: string) => bogo.filter((b) => b.variantId === vid).reduce((s, b) => s + b.cents, 0);
  /** Lines after their BOGO discount: what codes and automatic deals apply to. */
  const netLines = lines.map((l) => ({ ...l, lineTotalCents: l.lineTotalCents - bogoOn(l.variantId) }));
  const listSubtotalCents = lines.reduce((s, l) => s + l.listPriceCents * l.quantity, 0);
  const subtotalCents = lines.reduce((s, l) => s + l.lineTotalCents, 0) - bogoCents;
  const names = { listing: (lid: string) => input.variants.find((v) => v.listingId === lid)?.listingName, variant: (vid: string) => byId.get(vid)?.name };
  const hints = dealHints(deals, sources, names, plans);
  const noCodeDeal = plans.find((p) => p.rule.noCodes);

  const applied: CartPricing["applied"] = plans.map((p) => ({ id: p.deal.id, kind: "bogo" as const, label: dealText(p.deal, names), cents: p.cents }));
  let remaining = subtotalCents;
  let codeError = "";
  let usedCode = "";

  // 1. Discount code (one per order).
  const typed = (input.code ?? "").trim().toUpperCase();
  if (typed) {
    const p = input.promotions.find((x) => x.kind === "code" && x.code.toUpperCase() === typed);
    if (!p) codeError = "That code was not found. Check the spelling and try again.";
    else if (noCodeDeal) codeError = `Discount codes can’t be used with the “${dealText(noCodeDeal.deal, names)}” deal.`;
    else {
      const eligible = eligibleSubtotal(p, netLines, byId);
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
    const eligible = eligibleSubtotal(p, netLines, byId);
    if (promoBlock(p, eligible, now, email)) continue;
    const cents = Math.min(remaining, discountAmount(p.discountType, p.discountValue, eligible));
    if (cents > 0 && (!bestAuto || cents > bestAuto.cents)) bestAuto = { p, cents };
  }
  if (bestAuto) {
    applied.push({ id: bestAuto.p.id, kind: "auto", label: `${bestAuto.p.name || "Deal"}: ${promoValueLabel(bestAuto.p)}`, cents: bestAuto.cents });
    remaining -= bestAuto.cents;
  }

  // 3. Free shipping rules: date range + optional minimum, checked against the subtotal after discounts.
  //    Each rule makes only its own shipping options free; several matching rules add up.
  const free = new Set<ShippingTierId>();
  for (const p of input.promotions) {
    if (p.kind !== "free_shipping" || !isLive(p, now) || usesLeft(p) === 0) continue;
    if (p.shippingTiers.length === 0) continue;
    if (lines.length > 0 && remaining >= p.minSubtotalCents) {
      p.shippingTiers.forEach((t) => free.add(t));
      applied.push({ id: p.id, kind: "free_shipping", label: freeShippingText(p.shippingTiers, input.shippingTiers), cents: 0 });
    }
  }
  const freeTiers = TIER_ORDER.filter((t) => free.has(t));
  const freeShipping = freeTiers.length > 0;
  const freeShippingLabel = freeShipping ? freeShippingText(freeTiers, input.shippingTiers) : "";

  return {
    lines,
    listSubtotalCents,
    qtySavingsCents: listSubtotalCents - subtotalCents - bogoCents,
    subtotalCents,
    bogo,
    bogoCents,
    dealHints: hints,
    discountCents: subtotalCents - remaining,
    applied,
    codeError,
    code: usedCode,
    freeShipping,
    freeTiers,
    freeShippingLabel,
  };
}

/**
 * The order lines a priced cart is saved as. A size with BOGO units gets two lines: the units at their
 * normal price, and the discounted units on their own line (with the deal and the price before it).
 */
export function orderLinesOf(p: Pick<CartPricing, "lines" | "bogo">): { variantId: string; name: string; quantity: number; unitPriceCents: number; dealId: string; dealName: string; fullPriceCents: number | null }[] {
  const out: ReturnType<typeof orderLinesOf> = [];
  for (const l of p.lines) {
    const rows = p.bogo.filter((b) => b.variantId === l.variantId);
    const rest = l.quantity - rows.reduce((s, b) => s + b.quantity, 0);
    if (rest > 0) out.push({ variantId: l.variantId, name: l.name, quantity: rest, unitPriceCents: l.unitPriceCents, dealId: "", dealName: "", fullPriceCents: null });
    for (const b of rows) out.push({ variantId: l.variantId, name: l.name, quantity: b.quantity, unitPriceCents: b.unitPriceCents, dealId: b.dealId, dealName: b.dealName, fullPriceCents: b.fullPriceCents });
  }
  return out;
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
  store: Pick<StoreSettings, "shippingTiers">,
  /** Options made free by the free shipping rules that matched the cart (CartPricing.freeTiers). */
  freeTiers: ShippingTierId[],
  live?: Partial<Record<ShippingTierId, { cents: number; service: string; estimate: string }>>,
): ShippingOption[] {
  return store.shippingTiers
    .filter((tier) => tier.enabled)
    .map((tier) => {
      const l = live?.[tier.id];
      const baseCents = Math.max(0, l ? l.cents : tier.flatCents);
      const free = freeTiers.includes(tier.id);
      return { tier: tier.id, name: tier.name, service: l?.service ?? "", cents: free ? 0 : baseCents, baseCents, free, estimate: l?.estimate ?? "" };
    });
}

/** Text for the announcement bar generated from what is live right now. Empty when nothing is. */
export function promoHeadlines(promotions: PromotionRec[], now = new Date(), shippingTiers?: Pick<ShippingTier, "id" | "name" | "enabled">[]): { text: string; code: string }[] {
  const out: { text: string; code: string }[] = [];
  for (const p of promotions) {
    if (!isLive(p, now)) continue;
    const left = usesLeft(p);
    if (left === 0) continue;
    const min = p.minSubtotalCents > 0 ? ` on orders ${money(p.minSubtotalCents)}+` : "";
    if (p.kind === "free_shipping") {
      if (p.shippingTiers.length > 0) out.push({ text: `${freeShippingText(p.shippingTiers, shippingTiers)}${min}`, code: "" });
    }
    else if (p.kind === "bogo") {
      if (p.bogo?.online && p.name.trim()) out.push({ text: p.name.trim(), code: "" });
    } else if (p.kind === "auto") out.push({ text: `${promoValueLabel(p)}${min}${left !== null ? `: ${left} left` : ""}`, code: "" });
    else if (p.kind === "code" && p.listingIds.length === 0 && p.groupIds.length === 0 && !p.oncePerEmail && left === null) {
      // Only open, unlimited codes are advertised automatically.
      out.push({ text: `${promoValueLabel(p)}${min} with code`, code: p.code });
    }
  }
  return out;
}
