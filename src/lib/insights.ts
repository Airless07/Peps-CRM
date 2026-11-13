// Read-only reports derived from orders. They never feed back into the money engine.
import { orderTotals } from "./money";
import type { CustomerRec, OrderRec, ProductRec } from "./types";
import { UNKNOWN_PAYMENT } from "./types";

type TotalsOrder = Pick<OrderRec, "discountType" | "discountValue" | "tipCents" | "lines">;
/** What the customer actually paid: subtotal minus discount plus tip. */
export const collected = (o: TotalsOrder) => orderTotals(o).total;

export interface PaymentRow {
  method: string;
  /** Collected, after discounts, including tips. */
  total: number;
  orders: number;
}

/**
 * Money collected per payment method. Methods follow the Settings order; methods no
 * longer offered (and "Unknown") come after, by total.
 */
export function paymentBreakdown(orders: (TotalsOrder & Pick<OrderRec, "paymentMethod">)[], methodOrder: string[] = []): PaymentRow[] {
  const rows = new Map<string, PaymentRow>();
  for (const o of orders) {
    const method = o.paymentMethod?.trim() || UNKNOWN_PAYMENT;
    const r = rows.get(method) ?? { method, total: 0, orders: 0 };
    r.total += collected(o);
    r.orders += 1;
    rows.set(method, r);
  }
  const rank = (m: string) => {
    const i = methodOrder.indexOf(m);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...rows.values()].sort((a, b) => rank(a.method) - rank(b.method) || b.total - a.total || a.method.localeCompare(b.method));
}

export interface CustomerStats {
  customer: CustomerRec;
  /** Order totals after discounts, including tips. */
  totalSpent: number;
  orders: number;
  lastOrder: string | null;
  avgOrder: number;
  favoriteProduct: { name: string; units: number } | null;
}

export function customerStats(customers: CustomerRec[], orders: OrderRec[], products: ProductRec[] = []): Map<string, CustomerStats> {
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const out = new Map<string, CustomerStats>();
  const units = new Map<string, Map<string, { name: string; units: number }>>();
  for (const c of customers) {
    out.set(c.id, { customer: c, totalSpent: 0, orders: 0, lastOrder: null, avgOrder: 0, favoriteProduct: null });
    units.set(c.id, new Map());
  }
  for (const o of orders) {
    const st = o.customerId ? out.get(o.customerId) : undefined;
    if (!st) continue;
    st.totalSpent += collected(o);
    st.orders += 1;
    if (!st.lastOrder || new Date(o.date) > new Date(st.lastOrder)) st.lastOrder = o.date;
    const u = units.get(o.customerId!)!;
    for (const l of o.lines) {
      const key = l.productId ?? `name:${l.productName}`;
      const cur = u.get(key) ?? { name: (l.productId && productName.get(l.productId)) || l.productName || "Deleted product", units: 0 };
      cur.units += l.quantity;
      u.set(key, cur);
    }
  }
  for (const [id, st] of out) {
    st.avgOrder = st.orders ? Math.round(st.totalSpent / st.orders) : 0;
    let best: { name: string; units: number } | null = null;
    for (const v of units.get(id)!.values()) if (!best || v.units > best.units) best = v;
    st.favoriteProduct = best;
  }
  return out;
}

/** "today", "yesterday", "12 days ago" (calendar days, local time). */
export function daysAgo(iso: string, now = new Date()): string {
  const a = new Date(iso);
  const d0 = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const d1 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const n = Math.round((d1 - d0) / 864e5);
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  return `${n} days ago`;
}
