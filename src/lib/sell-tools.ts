// Sell screen shortcuts: repeat an order, recent customers, today's summary and a copyable receipt. Pure.
import { cashHolderOf } from "./cash";
import type { Draft, DraftLine } from "./draft";
import { dayKey, fmtDateTime, fmtMoney, uid } from "./format";
import type { Ledger } from "./money";
import { orderTotals } from "./money";
import { lineName, withSize } from "./size";
import type { AppData, CustomerRec, OrderRec, Partner, ProductRec } from "./types";

// ---------------------------------------------------------------- Repeat an order
/**
 * A new Sell cart with the same items as `o`, at today's prices and costs, for the same customer.
 * BOGO units go back into their item (deals are applied again by the cart). Items whose product was
 * deleted or archived are left out and named in `skipped`.
 */
export function repeatOrderDraft(
  o: OrderRec,
  ctx: { products: ProductRec[]; costOf: (productId: string) => number | undefined; cutPercent: number; base: Draft },
): { draft: Draft; skipped: string[] } {
  const products = new Map(ctx.products.map((p) => [p.id, p]));
  const qty = new Map<string, number>();
  const skipped: string[] = [];
  for (const l of [...o.lines].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const p = l.productId ? products.get(l.productId) : undefined;
    if (!p || p.archived) {
      const n = lineName(l);
      if (!skipped.includes(n)) skipped.push(n);
      continue;
    }
    qty.set(p.id, (qty.get(p.id) ?? 0) + l.quantity);
  }
  const lines: DraftLine[] = [...qty.entries()].map(([pid, q]) => {
    const p = products.get(pid)!;
    return { id: uid(), productId: p.id, productName: withSize(p.name, p.variantLabel), quantity: q, unitPriceCents: p.defaultPriceCents, unitCostCents: ctx.costOf(p.id) ?? 0, cutPercent: ctx.cutPercent };
  });
  return {
    draft: {
      ...ctx.base,
      id: uid(),
      date: new Date().toISOString(),
      customer: o.customer,
      customerId: o.customerId,
      note: "",
      discountType: "$",
      discountValue: 0,
      tipCents: 0,
      owner: null,
      cashTo: null,
      lines,
    },
    skipped,
  };
}

/** The most recent order of a customer (any source), or null. */
export const lastOrderOf = (data: Pick<AppData, "orders">, customerId: string): OrderRec | null =>
  data.orders.filter((o) => o.customerId === customerId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] ?? null;

/** Customers of the latest orders, newest first, each once. */
export function recentCustomers(data: Pick<AppData, "orders" | "customers">, n = 5): CustomerRec[] {
  const byId = new Map(data.customers.map((c) => [c.id, c]));
  const out: CustomerRec[] = [];
  for (const o of [...data.orders].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())) {
    const c = o.customerId ? byId.get(o.customerId) : undefined;
    if (c && !out.includes(c)) out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

// ---------------------------------------------------------------- Today
export interface DayRow {
  count: number;
  /** After discounts, before tips (like the Money page). */
  revenue: number;
  /** Revenue minus cost, plus tips (like the Money page). */
  profit: number;
}
export interface TodaySummary extends DayRow {
  bySeller: Record<Partner, DayRow>;
  byMethod: ({ method: string } & DayRow)[];
  /** Cash received today, per partner (order totals, tips included). */
  cash: Record<Partner, number>;
  /** Owner purchases today (not in the numbers above). */
  owner: { count: number; costCents: number };
}

/** In-person sales today (local day). Owner purchases are counted apart, like on the Money page. */
export function todaySummary(data: Pick<AppData, "orders" | "settings">, ledger: Pick<Ledger, "orders">, now = new Date()): TodaySummary {
  const key = dayKey(now);
  const row = (): DayRow => ({ count: 0, revenue: 0, profit: 0 });
  const out: TodaySummary = { ...row(), bySeller: { A: row(), B: row() }, byMethod: [], cash: { A: 0, B: 0 }, owner: { count: 0, costCents: 0 } };
  const methods = new Map<string, DayRow>();
  for (const o of data.orders) {
    if (o.source !== "inperson" || dayKey(o.date) !== key) continue;
    const r = ledger.orders.get(o.id);
    if (!r) continue;
    const who = cashHolderOf(o);
    if (who) out.cash[who] += r.total;
    if (o.owner) {
      out.owner.count++;
      out.owner.costCents += r.cost;
      continue;
    }
    const add = (x: DayRow) => {
      x.count++;
      x.revenue += r.revenue;
      x.profit += r.profit + r.tip;
    };
    add(out);
    if (o.soldBy === "A" || o.soldBy === "B") add(out.bySeller[o.soldBy]);
    const m = o.paymentMethod.trim() || "Unknown";
    const mr = methods.get(m) ?? row();
    add(mr);
    methods.set(m, mr);
  }
  const rank = (m: string) => {
    const i = data.settings.paymentMethods.indexOf(m);
    return i === -1 ? 999 : i;
  };
  out.byMethod = [...methods.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => rank(a.method) - rank(b.method) || b.revenue - a.revenue);
  return out;
}

// ---------------------------------------------------------------- Receipt
/**
 * A plain text receipt to paste into a text message: order number, items with sizes, any discount or
 * BOGO, total, date. BOGO items are listed at their normal price with the deal taken off under them.
 */
export function receiptText(o: Pick<OrderRec, "number" | "date" | "lines" | "discountType" | "discountValue" | "tipCents" | "paymentMethod" | "owner" | "customer">, opts: { storeName: string; ownerName?: string }): string {
  const t = orderTotals(o);
  const out: string[] = [];
  if (opts.storeName.trim()) out.push(opts.storeName.trim());
  out.push(o.number ? `Order #${o.number}` : "Order");
  out.push(fmtDateTime(o.date));
  if (o.customer.trim()) out.push(`For ${o.customer.trim()}`);
  out.push("");
  const lines = [...o.lines].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const l of lines) {
    const full = l.dealId && l.fullPriceCents != null ? l.fullPriceCents : l.unitPriceCents;
    out.push(`${l.quantity}× ${lineName(l)}  ${fmtMoney(full * l.quantity)}`);
    if (l.dealId && l.fullPriceCents != null && l.fullPriceCents > l.unitPriceCents) {
      out.push(`  BOGO (${l.dealName || "deal"})  -${fmtMoney((l.fullPriceCents - l.unitPriceCents) * l.quantity)}`);
    }
  }
  out.push("");
  if (o.owner) out.push(`Owner price${opts.ownerName ? ` (${opts.ownerName})` : ""}: charged at cost`);
  if (t.discount > 0) out.push(`Discount${o.discountType === "%" ? ` (${o.discountValue}%)` : ""}  -${fmtMoney(t.discount)}`);
  if (t.tip > 0) out.push(`Tip  ${fmtMoney(t.tip)}`);
  out.push(`Total  ${fmtMoney(t.total)}`);
  if (o.paymentMethod.trim() && o.paymentMethod !== "Unknown") out.push(`Paid with ${o.paymentMethod.trim()}`);
  out.push("", "Thank you!");
  return out.join("\n");
}
