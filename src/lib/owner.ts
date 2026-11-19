// Owner price: a partner buys at cost on the Sell screen. Pure helpers.
// Money: every line is charged its cost per unit, so revenue = cost, profit = $0 and nothing is
// splittable (the ledger also forces this, src/lib/money.ts). All of it is business money.
// Stock drops like a normal sale. Stats on the Money page leave these orders out.
import { mergeDealLines } from "./bogo";
import type { Draft, DraftLine } from "./draft";
import type { Ledger } from "./money";
import type { OrderRec, Partner } from "./types";

export const isOwnerOrder = (o: Pick<OrderRec, "owner">) => !!o.owner;

/**
 * Turn owner price on (for `owner`) or off (null). On: each line is charged its current cost, the
 * normal price is kept to show struck through, and discounts, tips and BOGO deals are cleared.
 * Off: normal prices come back.
 */
export function setOwnerPrice(
  d: Draft,
  owner: Partner | null,
  ctx: { costOf: (productId: string) => number | undefined; priceOf: (productId: string) => number | undefined },
): Draft {
  if (owner) {
    return {
      ...d,
      owner,
      discountType: "$",
      discountValue: 0,
      tipCents: 0,
      lines: mergeDealLines(d.lines).map((l) => ownerLine(l, ctx.costOf)),
    };
  }
  return {
    ...d,
    owner: null,
    lines: d.lines.map(({ fullPriceCents, ...l }) => ({ ...l, unitPriceCents: fullPriceCents ?? (l.productId ? ctx.priceOf(l.productId) : undefined) ?? l.unitPriceCents })),
  };
}

/** A line at owner price: charged its current cost, the normal price remembered. */
export function ownerLine(l: DraftLine, costOf: (productId: string) => number | undefined): DraftLine {
  const cost = (l.productId ? costOf(l.productId) : undefined) ?? l.unitCostCents;
  return { ...l, fullPriceCents: l.fullPriceCents ?? l.unitPriceCents, unitCostCents: cost, unitPriceCents: cost };
}

/** Names of the lines whose cost per unit is $0 (owner price would charge nothing for them). */
export const zeroCostLines = (lines: Pick<DraftLine, "productId" | "productName" | "unitCostCents">[], costOf: (productId: string) => number | undefined) =>
  [...new Set(lines.filter((l) => ((l.productId ? costOf(l.productId) : undefined) ?? l.unitCostCents) <= 0).map((l) => l.productName || "Deleted product"))];

export interface OwnerSummary {
  count: number;
  /** What the items cost (= what was paid). */
  costCents: number;
  units: number;
  byOwner: Record<Partner, { count: number; costCents: number; units: number }>;
}

/** Owner purchases among `orders`, for their own section on the Money page. */
export function ownerSummary(orders: OrderRec[], ledger: Ledger): OwnerSummary {
  const out: OwnerSummary = { count: 0, costCents: 0, units: 0, byOwner: { A: { count: 0, costCents: 0, units: 0 }, B: { count: 0, costCents: 0, units: 0 } } };
  for (const o of orders) {
    if (!o.owner) continue;
    const r = ledger.orders.get(o.id);
    if (!r) continue;
    out.count++;
    out.costCents += r.cost;
    out.units += r.units;
    const b = out.byOwner[o.owner];
    b.count++;
    b.costCents += r.cost;
    b.units += r.units;
  }
  return out;
}
