// Saved (open) in-person orders: a Sell cart put aside to finish later. Pure helpers.
// A saved order is not an order: it is never part of AppData.orders, so the money and stock
// math cannot see it. Completing one goes through the same steps as a normal sale (finalizeSale).
import { resolveDraftCustomer, type Draft, type DraftLine } from "./draft";
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
    lines: draft.lines.map((l): SavedLineRec => {
      const old = before.get(l.id);
      const listPriceCents = old && old.productId === l.productId ? old.listPriceCents : l.productId ? price.get(l.productId) ?? null : null;
      return { id: l.id, productId: l.productId, productName: l.productName, quantity: l.quantity, unitPriceCents: l.unitPriceCents, unitCostCents: l.unitCostCents, cutPercent: l.cutPercent, listPriceCents };
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
    lines: s.lines.map(toDraftLine),
  };
}

export const savedTotals = (s: Pick<SavedOrderRec, "lines" | "discountType" | "discountValue" | "tipCents">) => orderTotals(s);

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
export function priceChanges(s: Pick<SavedOrderRec, "lines">, products: Pick<ProductRec, "id" | "defaultPriceCents">[]): PriceChange[] {
  const price = new Map(products.map((p) => [p.id, p.defaultPriceCents]));
  const out: PriceChange[] = [];
  for (const l of s.lines) {
    if (!l.productId || l.listPriceCents === null) continue;
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
  ctx: { customers: CustomerRec[]; unitCost: (productId: string) => number | undefined; cutPercent: number; now?: string },
): { final: Draft; created: CustomerRec | null } {
  const now = ctx.now ?? new Date().toISOString();
  const { draft: linked, created } = resolveDraftCustomer(draft, ctx.customers, now);
  return {
    final: {
      ...linked,
      date: now,
      lines: draft.lines.map((l) => ({
        ...l,
        unitCostCents: l.productId ? ctx.unitCost(l.productId) ?? l.unitCostCents : l.unitCostCents,
        cutPercent: ctx.cutPercent,
      })),
    },
    created,
  };
}
