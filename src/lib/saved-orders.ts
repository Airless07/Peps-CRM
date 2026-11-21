// Saved (open) in-person orders: a Sell cart put aside to finish later. Pure helpers.
// A saved order is not an order: it is never part of AppData.orders, so the money and stock
// math cannot see it. Completing one goes through the same steps as a normal sale (finalizeSale).
import { resolveDraftCustomer, type Draft, type DraftLine } from "./draft";
import { isCash } from "./cash";
import { orderTotals } from "./money";
import type { CustomerRec, ProductRec, SavedLineRec, SavedOrderRec } from "./types";

/**
 * Turn the cart into a saved order. Prices, discount and tip are kept exactly as they are.
 * Each line also remembers the product's regular price at the moment it was first saved, so a
 * later price change can be pointed out. `prev` is the saved order being re-saved after "Open".
 */
export function toSavedOrder(draft: Draft, products: Pick<ProductRec, "id" | "defaultPriceCents">[], prev?: SavedOrderRec | null, now = new Date().toISOString()): SavedOrderRec {
  const price = new Map(products.map((p) => [p.id, p.defaultPriceCents]));
  const before = new Map((prev?.lines ?? []).map((l) => [l.id, l]));
  return {
    id: draft.id,
    savedAt: now,
    customer: draft.customer.trim(),
    customerId: draft.customer.trim() ? draft.customerId : null,
    paymentMethod: draft.paymentMethod,
    note: draft.note,
    soldBy: draft.soldBy,
    discountType: draft.discountType,
    discountValue: draft.discountValue,
    tipCents: draft.tipCents,
    owner: draft.owner ?? null,
    cashTo: draft.cashTo ?? null,
    // The credit is only held while saved; it comes off the balance when the order is completed.
    storeCreditCents: draft.customer.trim() && !draft.owner ? draft.storeCreditCents ?? 0 : 0,
    referredById: draft.referredById ?? null,
    lines: draft.lines.map((l): SavedLineRec => {
      const old = before.get(l.id);
      const listPriceCents = old && old.productId === l.productId ? old.listPriceCents : l.productId ? price.get(l.productId) ?? null : null;
      return {
        id: l.id,
        productId: l.productId,
        productName: l.productName,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        unitCostCents: l.unitCostCents,
        cutPercent: l.cutPercent,
        listPriceCents,
        ...(l.dealId ? { dealId: l.dealId, dealName: l.dealName ?? "" } : {}),
        ...(l.fullPriceCents != null ? { fullPriceCents: l.fullPriceCents } : {}),
      };
    }),
  };
}

const toDraftLine = ({ listPriceCents: _l, ...l }: SavedLineRec): DraftLine => l;

/** Load a saved order back into the cart. Same id, so saving again updates it and completing removes it. */
export function savedToDraft(s: SavedOrderRec, fallbackPayment: string, now = new Date().toISOString()): Draft {
  return {
    id: s.id,
    date: now,
    customer: s.customer,
    customerId: s.customerId,
    paymentMethod: s.paymentMethod || fallbackPayment,
    note: s.note,
    soldBy: s.soldBy,
    discountType: s.discountType,
    discountValue: s.discountValue,
    tipCents: s.tipCents,
    owner: s.owner ?? null,
    cashTo: s.cashTo ?? null,
    storeCreditCents: s.storeCreditCents ?? 0,
    referredById: s.referredById ?? null,
    lines: s.lines.map(toDraftLine),
  };
}

export const savedTotals = (s: Pick<SavedOrderRec, "lines" | "discountType" | "discountValue" | "tipCents" | "storeCreditCents">) => orderTotals(s);

/** Cost of a saved line: the variant's CURRENT cost per unit, or the cost noted on the line when the product is gone. */
const lineCost = (l: Pick<SavedLineRec, "productId" | "quantity" | "unitCostCents">, costOf: (productId: string) => number | undefined) =>
  l.quantity * ((l.productId ? costOf(l.productId) : undefined) ?? l.unitCostCents);

/** Profit of one saved order if it were completed now: total after discounts (with tip) minus each item's current cost. Display only. */
export function savedProfit(s: Pick<SavedOrderRec, "lines" | "discountType" | "discountValue" | "tipCents">, costOf: (productId: string) => number | undefined): number {
  return savedTotals(s).total - s.lines.reduce((x, l) => x + lineCost(l, costOf), 0);
}

export interface SavedSummary {
  count: number;
  /** All saved orders after discounts, tips included. */
  revenueCents: number;
  /** The tips inside revenueCents. */
  tipCents: number;
  /** revenueCents minus every item's current cost. */
  profitCents: number;
  /** Discounts given across all saved orders (a positive number). */
  discountCents: number;
}

/** The header of the saved orders list. Display only: Money never reads saved orders. */
export function savedSummary(list: Pick<SavedOrderRec, "lines" | "discountType" | "discountValue" | "tipCents">[], costOf: (productId: string) => number | undefined): SavedSummary {
  const out: SavedSummary = { count: list.length, revenueCents: 0, tipCents: 0, profitCents: 0, discountCents: 0 };
  for (const o of list) {
    const t = savedTotals(o);
    out.revenueCents += t.total;
    out.tipCents += t.tip;
    out.discountCents += t.discount;
    out.profitCents += savedProfit(o, costOf);
  }
  return out;
}

export const savedItemsText = (s: Pick<SavedOrderRec, "lines">) => s.lines.map((l) => `${l.quantity > 1 ? l.quantity + "× " : ""}${l.productName || "Deleted product"}`).join(", ");

export interface PriceChange {
  lineId: string;
  productName: string;
  /** Regular price when the order was saved. */
  wasCents: number;
  /** Regular price now. */
  nowCents: number;
  /** What the saved order charges (unchanged). */
  savedCents: number;
}

/** Lines whose product has a different regular price now than when the order was saved. The saved price stays. */
export function priceChanges(s: Pick<SavedOrderRec, "lines" | "owner">, products: Pick<ProductRec, "id" | "defaultPriceCents">[]): PriceChange[] {
  const price = new Map(products.map((p) => [p.id, p.defaultPriceCents]));
  const out: PriceChange[] = [];
  // Owner price charges the saved cost, and deal lines follow the deal: a new regular price changes neither.
  if (s.owner) return out;
  for (const l of s.lines) {
    if (!l.productId || l.listPriceCents === null || l.dealId) continue;
    const now = price.get(l.productId);
    if (now === undefined || now === l.listPriceCents) continue;
    out.push({ lineId: l.id, productName: l.productName, wasCents: l.listPriceCents, nowCents: now, savedCents: l.unitPriceCents });
  }
  return out;
}

/**
 * Units of a product held by one saved order. Saved orders take their items out of stock while they
 * wait (src/lib/money.ts), so a sale that completes or edits that same order gets them back first.
 */
export const heldBy = (saved: Pick<SavedOrderRec, "lines"> | null | undefined, productId: string) =>
  (saved?.lines ?? []).filter((l) => l.productId === productId).reduce((x, l) => x + l.quantity, 0);

/** Names of the products this sale would push below zero stock. Empty = enough stock. */
export function stockShortfalls(lines: Pick<DraftLine, "productId" | "productName" | "quantity">[], stockOf: (productId: string) => number): string[] {
  const need = new Map<string, { name: string; qty: number }>();
  for (const l of lines) {
    if (!l.productId) continue;
    const cur = need.get(l.productId);
    need.set(l.productId, { name: cur?.name ?? l.productName, qty: (cur?.qty ?? 0) + l.quantity });
  }
  return [...need.entries()].filter(([pid, n]) => stockOf(pid) - n.qty < 0).map(([, n]) => n.name);
}

/**
 * The last step of every in-person sale, from the cart or from a saved order: link the customer,
 * stamp the time, and snapshot cost and business cut as they are right now. Prices, quantities,
 * discount and tip are never touched.
 */
export function finalizeSale(
  draft: Draft,
  ctx: { customers: CustomerRec[]; unitCost: (productId: string) => number | undefined; cutPercent: number; now?: string; fromSaved?: boolean },
): { final: Draft; created: CustomerRec | null } {
  const now = ctx.now ?? new Date().toISOString();
  const { draft: linked, created } = resolveDraftCustomer(draft, ctx.customers, now);
  const owner = draft.owner ?? null;
  const cashTo = isCash(draft.paymentMethod) ? draft.cashTo ?? (draft.soldBy === "A" || draft.soldBy === "B" ? draft.soldBy : null) : null;
  return {
    final: {
      ...linked,
      date: now,
      owner,
      cashTo,
      // Owner price: no discount, no tip, no store credit (the server enforces the same).
      ...(owner ? { discountType: "$" as const, discountValue: 0, tipCents: 0, storeCreditCents: 0 } : {}),
      lines: draft.lines.map((l) => {
        if (owner) {
          // A saved owner order keeps the cost prices it was saved with; a fresh one is charged today's cost.
          const cost = ctx.fromSaved ? l.unitPriceCents : (l.productId ? ctx.unitCost(l.productId) : undefined) ?? l.unitCostCents;
          return { ...l, unitCostCents: cost, unitPriceCents: cost, cutPercent: ctx.cutPercent };
        }
        return { ...l, unitCostCents: l.productId ? ctx.unitCost(l.productId) ?? l.unitCostCents : l.unitCostCents, cutPercent: ctx.cutPercent };
      }),
    },
    created,
  };
}
