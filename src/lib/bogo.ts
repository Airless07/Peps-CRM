// BOGO deals ("buy 1, get 1 free", "buy 2, get 1 half off"). Pure: the same rules price the website
// cart (src/lib/store/pricing.ts) and the Sell cart (applySellDeals below).
//
// Money: the discounted units are their own order lines at the lower price, with the normal cost. So the
// ledger counts their cost, revenue is $0 (or reduced), profit drops, and stock drops for every unit.
import type { Draft, DraftLine } from "./draft";
import type { BogoRule, DealItems, ProductRec, PromotionRec } from "./types";

/** What a deal can draw units from: one cart line (online: a size; in person: a Sell cart line). */
export interface DealSource {
  key: string;
  variantId: string;
  listingId: string;
  /** Price each the deal works from. */
  unitCents: number;
  qty: number;
}

export interface DealPlan {
  deal: PromotionRec;
  rule: BogoRule;
  /** How many times the deal applies. */
  times: number;
  /** Discounted units per source key. */
  gets: Map<string, { qty: number; offEachCents: number }>;
  /** Total taken off. */
  cents: number;
  /** Products (listings) whose units the deal used, as buy or get. */
  listings: Set<string>;
}

export type Channel = "online" | "inperson";

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : null);

/** A BOGO deal that is on, in its dates, has uses left and is offered on this channel. */
export function dealLive(p: PromotionRec, now: Date, channel: Channel): boolean {
  const r = p.bogo;
  if (p.kind !== "bogo" || !r || !p.active) return false;
  const s = ms(p.startsAt);
  const e = ms(p.endsAt);
  const n = now.getTime();
  if ((s !== null && n < s) || (e !== null && n > e)) return false;
  if (p.maxUses !== null && p.uses.length >= p.maxUses) return false;
  return channel === "online" ? r.online : r.inPerson;
}

export const liveDeals = (promotions: PromotionRec[], now: Date, channel: Channel) => promotions.filter((p) => dealLive(p, now, channel));

export const inItems = (sel: DealItems, variantId: string, listingId: string) => sel.variantIds.includes(variantId) || (!!listingId && sel.listingIds.includes(listingId));
/** The items the "get" side covers. */
export const getSide = (r: BogoRule): DealItems => (r.get.same ? r.buy : r.get);
const pctOf = (r: BogoRule) => Math.max(1, Math.min(100, r.get.percentOff || 100));
/** Amount taken off one unit. */
export const offEach = (unitCents: number, percentOff: number) => Math.max(0, Math.min(unitCents, Math.round((unitCents * percentOff) / 100)));

type Unit = { key: string; listingId: string; cents: number; id: number };

/** How a deal applies to these units (null = it doesn't). */
export function planDeal(deal: PromotionRec, sources: DealSource[]): DealPlan | null {
  const r = deal.bogo;
  if (!r) return null;
  const b = Math.max(1, Math.floor(r.buy.qty) || 1);
  const g = Math.max(1, Math.floor(r.get.qty) || 1);
  const pct = pctOf(r);
  const units: (Unit & { variantId: string })[] = [];
  let id = 0;
  for (const s of sources) for (let i = 0; i < Math.min(999, s.qty); i++) units.push({ key: s.key, variantId: s.variantId, listingId: s.listingId, cents: s.unitCents, id: id++ });

  const gotten: Unit[] = [];
  const used: Unit[] = [];
  let times = 0;
  if (r.get.same) {
    // Same item: every group of (buy + get) units, priciest first; the cheapest units of each group are discounted.
    const pool = units.filter((u) => inItems(r.buy, u.variantId, u.listingId)).sort((x, y) => y.cents - x.cents || x.id - y.id);
    times = Math.floor(pool.length / (b + g));
    for (let t = 0; t < times; t++) {
      const group = pool.slice(t * (b + g), (t + 1) * (b + g));
      used.push(...group);
      gotten.push(...group.slice(b));
    }
  } else {
    // A different item: units that are only on the buy side are bought first, the cheapest get-side units are discounted.
    const isBuy = (u: (typeof units)[number]) => inItems(r.buy, u.variantId, u.listingId);
    const isGet = (u: (typeof units)[number]) => inItems(r.get, u.variantId, u.listingId);
    const buyPool = units.filter(isBuy).sort((x, y) => Number(isGet(x)) - Number(isGet(y)) || y.cents - x.cents || x.id - y.id);
    const getPool = units.filter(isGet).sort((x, y) => Number(isBuy(x)) - Number(isBuy(y)) || x.cents - y.cents || x.id - y.id);
    const taken = new Set<number>();
    const take = (pool: Unit[], n: number): Unit[] | null => {
      const out: Unit[] = [];
      for (const u of pool) {
        if (out.length === n) break;
        if (!taken.has(u.id)) out.push(u);
      }
      return out.length === n ? out : null;
    };
    for (;;) {
      const buys = take(buyPool, b);
      if (!buys) break;
      buys.forEach((u) => taken.add(u.id));
      const gets = take(getPool, g);
      if (!gets) {
        buys.forEach((u) => taken.delete(u.id));
        break;
      }
      gets.forEach((u) => taken.add(u.id));
      used.push(...buys, ...gets);
      gotten.push(...gets);
      times++;
    }
  }
  if (times === 0) return null;
  const gets = new Map<string, { qty: number; offEachCents: number }>();
  let cents = 0;
  for (const u of gotten) {
    const off = offEach(u.cents, pct);
    cents += off;
    const cur = gets.get(u.key);
    // A source has one price, so each of its units takes the same amount off.
    gets.set(u.key, { qty: (cur?.qty ?? 0) + 1, offEachCents: off });
  }
  if (cents <= 0) return null;
  return { deal, rule: r, times, gets, cents, listings: new Set(used.map((u) => u.listingId)) };
}

/**
 * Every deal that applies, best first, never two deals on the same product (so no unit is counted twice).
 * `accept` can refuse a plan (the website uses it to keep buy-more savings when they are the better price).
 */
export function pickDeals(deals: PromotionRec[], sources: DealSource[], accept: (plan: DealPlan, chosen: DealPlan[]) => boolean = () => true): DealPlan[] {
  const plans = deals
    .map((d) => planDeal(d, sources))
    .filter((p): p is DealPlan => !!p)
    .sort((x, y) => y.cents - x.cents || x.deal.createdAt.localeCompare(y.deal.createdAt));
  const chosen: DealPlan[] = [];
  const touched = new Set<string>();
  for (const p of plans) {
    if ([...p.listings].some((l) => touched.has(l))) continue;
    if (!accept(p, chosen)) continue;
    chosen.push(p);
    p.listings.forEach((l) => touched.add(l));
  }
  return chosen;
}

// ---------------------------------------------------------------- Words
export const percentText = (pct: number) => (pct >= 100 ? "free" : `${pct}% off`);

/** "GHK-Cu", "GHK-Cu 100mg", "BPC-157 or TB-500". */
export function itemsLabel(sel: DealItems, names: { listing: (id: string) => string | undefined; variant: (id: string) => string | undefined }): string {
  const list = [...sel.listingIds.map(names.listing), ...sel.variantIds.map(names.variant)].filter((x): x is string => !!x);
  if (list.length === 0) return "the item";
  if (list.length <= 2) return list.join(" or ");
  return `${list.slice(0, 2).join(", ")} or similar`;
}

/** Default customer text when the deal has no name: "Buy 1 GHK-Cu, get 1 free". */
export function dealText(p: Pick<PromotionRec, "name" | "bogo">, names: Parameters<typeof itemsLabel>[1]): string {
  if (p.name.trim()) return p.name.trim();
  const r = p.bogo;
  if (!r) return "BOGO deal";
  const buy = itemsLabel(r.buy, names);
  const get = r.get.same ? "" : ` ${itemsLabel(r.get, names)}`;
  return `Buy ${r.buy.qty} ${buy}, get ${r.get.qty}${get} ${percentText(pctOf(r))}`;
}

/**
 * Nudges for deals that are almost there: "Add 1 more GHK-Cu to get it free". Only for deals that are
 * live and not (fully) used by the cart yet.
 */
export function dealHints(deals: PromotionRec[], sources: DealSource[], names: Parameters<typeof itemsLabel>[1], chosen: DealPlan[] = []): { dealId: string; text: string }[] {
  const out: { dealId: string; text: string }[] = [];
  const busy = new Set(chosen.flatMap((c) => [...c.listings]));
  for (const d of deals) {
    const r = d.bogo;
    if (!r) continue;
    const b = Math.max(1, r.buy.qty);
    const g = Math.max(1, r.get.qty);
    const count = (sel: DealItems, not?: DealItems) =>
      sources.filter((s) => inItems(sel, s.variantId, s.listingId) && !(not && inItems(not, s.variantId, s.listingId))).reduce((x, s) => x + s.qty, 0);
    const mine = sources.filter((s) => inItems(r.buy, s.variantId, s.listingId) || inItems(getSide(r), s.variantId, s.listingId));
    // Another deal already uses these products: no nudge (the two never stack).
    if (mine.some((s) => busy.has(s.listingId)) && !chosen.some((c) => c.deal.id === d.id)) continue;
    const them = g === 1 ? "it" : "them";
    const what = percentText(pctOf(r));
    if (r.get.same) {
      const n = count(r.buy);
      const rem = n % (b + g);
      if (rem >= b) out.push({ dealId: d.id, text: `Add ${b + g - rem} more ${itemsLabel(r.buy, names)} to get ${them} ${what}` });
    } else {
      const sets = Math.floor(count(r.buy, r.get) / b);
      const have = count(r.get);
      const need = sets * g - have;
      if (sets > 0 && need > 0) out.push({ dealId: d.id, text: `Add ${need} ${itemsLabel(r.get, names)} to get ${them} ${what}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Sell cart
const DEAL_SEP = "~";
export const isDealLine = (l: Pick<DraftLine, "dealId">) => !!l.dealId;

/** Put every deal line's units back into its regular line (the inverse of applying deals). */
export function mergeDealLines(lines: DraftLine[]): DraftLine[] {
  const out: DraftLine[] = [];
  for (const l of lines) {
    if (!isDealLine(l)) {
      out.push({ ...l });
      continue;
    }
    const baseId = l.id.split(DEAL_SEP)[0];
    const price = l.fullPriceCents ?? l.unitPriceCents;
    const base = out.find((x) => x.id === baseId) ?? out.find((x) => !isDealLine(x) && x.productId === l.productId && x.unitPriceCents === price);
    if (base) base.quantity += l.quantity;
    else {
      const { dealId: _d, dealName: _n, fullPriceCents: _f, ...rest } = l;
      out.push({ ...rest, id: baseId, unitPriceCents: price });
    }
  }
  return out;
}

/**
 * The Sell cart with every live in-person BOGO deal applied: discounted units move to their own line
 * ("BOGO: GHK-Cu 100mg") right under the line they came from. Safe to run again on its own output.
 * Owner price turns deals off.
 */
export function applySellDeals(d: Draft, ctx: { promotions: PromotionRec[]; products: Pick<ProductRec, "id" | "listingId">[]; now?: Date }): Draft {
  const base = mergeDealLines(d.lines);
  if (d.owner) return { ...d, lines: base };
  const deals = liveDeals(ctx.promotions, ctx.now ?? new Date(), "inperson");
  if (deals.length === 0) return base.length === d.lines.length && d.lines.every((l) => !isDealLine(l)) ? d : { ...d, lines: base };
  const listing = new Map(ctx.products.map((p) => [p.id, p.listingId ?? ""]));
  const sources: DealSource[] = base
    .filter((l) => l.productId && l.quantity > 0)
    .map((l) => ({ key: l.id, variantId: l.productId!, listingId: listing.get(l.productId!) ?? "", unitCents: l.unitPriceCents, qty: l.quantity }));
  const plans = pickDeals(deals, sources);
  if (plans.length === 0) return { ...d, lines: base };
  const lines: DraftLine[] = [];
  for (const l of base) {
    const parts = plans.map((p) => ({ p, g: p.gets.get(l.id) })).filter((x) => x.g);
    const off = parts.reduce((x, y) => x + y.g!.qty, 0);
    if (l.quantity - off > 0) lines.push({ ...l, quantity: l.quantity - off });
    for (const { p, g } of parts) {
      lines.push({
        ...l,
        id: `${l.id}${DEAL_SEP}${p.deal.id}`,
        quantity: g!.qty,
        unitPriceCents: l.unitPriceCents - g!.offEachCents,
        fullPriceCents: l.unitPriceCents,
        dealId: p.deal.id,
        dealName: p.deal.name.trim() || "BOGO",
      });
    }
  }
  return { ...d, lines };
}

/** Nudges for the Sell cart ("Add 1 more GHK-Cu to get it free"). None with owner price. */
export function sellDealHints(
  d: Draft,
  ctx: { promotions: PromotionRec[]; products: Pick<ProductRec, "id" | "listingId">[]; names: Parameters<typeof itemsLabel>[1]; now?: Date },
): { dealId: string; text: string }[] {
  if (d.owner) return [];
  const deals = liveDeals(ctx.promotions, ctx.now ?? new Date(), "inperson");
  if (deals.length === 0) return [];
  const listing = new Map(ctx.products.map((p) => [p.id, p.listingId ?? ""]));
  const sources: DealSource[] = mergeDealLines(d.lines)
    .filter((l) => l.productId && l.quantity > 0)
    .map((l) => ({ key: l.id, variantId: l.productId!, listingId: listing.get(l.productId!) ?? "", unitCents: l.unitPriceCents, qty: l.quantity }));
  return dealHints(deals, sources, ctx.names, pickDeals(deals, sources));
}

/** What a deal line takes off in total. */
export const dealLineOff = (l: Pick<DraftLine, "quantity" | "unitPriceCents" | "fullPriceCents" | "dealId">) => (l.dealId && l.fullPriceCents != null ? (l.fullPriceCents - l.unitPriceCents) * l.quantity : 0);
