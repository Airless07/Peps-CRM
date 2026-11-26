// Restock orders: the math, shared by the screen and the server. Pure. Integer cents.
//
// A line is a product/size, a number of vials and what the supplier charged for the line. Free lines cost $0.
// Extra costs and discounts (shipping, shipping discount, other discounts, a payment fee as an amount or a %)
// are spread over the PAID lines by their share of cost, so each vial's cost includes them; free lines stay $0.
// The lines add up to exactly the total paid.

export type QtyMode = "vials" | "boxes";
export type PriceMode = "vial" | "box" | "line";
export type FeeMode = "amount" | "percent";

export interface RestockLineInput {
  productId: string;
  /** Vials. */
  quantity: number;
  /** What the supplier charged for the whole line, before extras. 0 when free. */
  lineCents: number;
  free: boolean;
}

export interface RestockExtras {
  shippingCents: number;
  shippingDiscountCents: number;
  discountCents: number;
  feeMode: FeeMode;
  /** Cents for "amount", basis points for "percent" (500 = 5%). */
  feeValue: number;
}

export interface PlannedLine extends RestockLineInput {
  /** This line's share of the total paid (its cost in stock and money). */
  costCents: number;
  unitBeforeCents: number;
  unitAfterCents: number;
}

export interface RestockPlan {
  lines: PlannedLine[];
  productsCents: number;
  shippingCents: number;
  /** Shipping discount + other discounts. */
  discountsCents: number;
  feeCents: number;
  totalCents: number;
  /** "" when the order can be saved. */
  error: string;
}

/** Vials from the quantity form: boxes x vials per box, or vials. */
export const vialsFrom = (mode: QtyMode, vials: number, boxes: number, perBox: number) =>
  mode === "boxes" ? Math.max(0, Math.round(boxes)) * Math.max(0, Math.round(perBox)) : Math.max(0, Math.round(vials));

/** Line total from the price form: per vial, per box or line total. */
export function lineFrom(mode: PriceMode, priceCents: number, vials: number, perBox: number): number {
  if (mode === "line") return Math.max(0, Math.round(priceCents));
  if (mode === "box") return perBox > 0 ? Math.max(0, Math.round((priceCents * vials) / perBox)) : 0;
  return Math.max(0, Math.round(priceCents * vials));
}

/** The three price views of a line (rounded to the cent). */
export const pricesOf = (lineCents: number, vials: number, perBox: number) => ({
  vial: vials > 0 ? Math.round(lineCents / vials) : 0,
  box: vials > 0 ? Math.round((lineCents * perBox) / vials) : 0,
  line: lineCents,
});

/** Add a line; the same product/size merges into one line (free and paid of the same size stay apart). */
export function addLine<T extends RestockLineInput>(lines: T[], line: T): T[] {
  const i = lines.findIndex((l) => l.productId === line.productId && l.free === line.free);
  if (i < 0) return [...lines, line];
  const next = [...lines];
  next[i] = { ...next[i], quantity: next[i].quantity + line.quantity, lineCents: line.free ? 0 : next[i].lineCents + line.lineCents };
  return next;
}

/**
 * Spread `paid` over `weights` in proportion (largest remainder): the shares add up to exactly `paid`.
 * A 0 weight gets 0.
 */
export function spread(weights: number[], paid: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w * paid) / sum);
  const out = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - out[i], i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0, left = paid - out.reduce((a, b) => a + b, 0); k < left; k++) out[order[k][1]]++;
  return out;
}

export function planRestock(lines: RestockLineInput[], x: RestockExtras): RestockPlan {
  const clean = lines.map((l) => ({ ...l, quantity: Math.round(l.quantity), lineCents: l.free ? 0 : Math.max(0, Math.round(l.lineCents)) }));
  const productsCents = clean.reduce((s, l) => s + l.lineCents, 0);
  const shippingCents = Math.max(0, Math.round(x.shippingCents || 0));
  const discountsCents = Math.max(0, Math.round(x.shippingDiscountCents || 0)) + Math.max(0, Math.round(x.discountCents || 0));
  const base = productsCents + shippingCents - discountsCents;
  const feeCents = Math.max(0, x.feeMode === "percent" ? Math.round((Math.max(0, base) * (x.feeValue || 0)) / 10_000) : Math.round(x.feeValue || 0));
  const totalCents = base + feeCents;
  let error = "";
  if (clean.length === 0) error = "Add at least one product.";
  else if (clean.some((l) => !(l.quantity > 0))) error = "Every line needs at least 1 vial.";
  else if (totalCents < 0) error = "The discounts are more than the order. Check the amounts.";
  else if (productsCents === 0 && totalCents > 0) error = "Shipping and fees need at least one paid item to go on.";
  const costs = spread(clean.map((l) => l.lineCents), Math.max(0, totalCents));
  return {
    lines: clean.map((l, i) => ({
      ...l,
      costCents: costs[i],
      unitBeforeCents: l.quantity > 0 ? Math.round(l.lineCents / l.quantity) : 0,
      unitAfterCents: l.quantity > 0 ? Math.round(costs[i] / l.quantity) : 0,
    })),
    productsCents,
    shippingCents,
    discountsCents,
    feeCents,
    totalCents,
    error,
  };
}

/**
 * Cost per vial after a stock change, weighted with the stock already there.
 * `stock`/`cost`: now. `remove`: units (and their total cost) going away (an edited or deleted restock line).
 * `add`: units coming in. With no stock left the new units set the cost; with nothing at all it stays.
 */
export function costAfter(stock: number, cost: number, remove: { qty: number; cents: number }, add: { qty: number; cents: number }): number {
  let s = Math.max(0, stock);
  let value = s * cost;
  if (remove.qty > 0) {
    const left = s - remove.qty;
    if (left > 0) {
      value = Math.max(0, value - remove.cents);
      s = left;
    } else {
      value = 0;
      s = 0;
    }
  }
  const total = s + Math.max(0, add.qty);
  if (total <= 0) return cost;
  if (s === 0 && add.qty > 0) return Math.round(add.cents / add.qty);
  return Math.round((value + Math.max(0, add.cents)) / total);
}

export const defaultRestockName = (dateKey: string) => {
  const [y, m, d] = dateKey.split("-").map(Number);
  return `Restock ${new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
};
