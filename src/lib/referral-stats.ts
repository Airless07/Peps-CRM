// Referral numbers for one code owner, from AppData. Pure: used by the admin Referrals pages and the
// customer's own Referrals dashboard (which only ever shows the buyer's first name + last initial).
import { balanceOf, pendingOf } from "./credit";
import { orderTotals } from "./money";
import type { AppData, CreditEntryRec, OrderRec } from "./types";

export type UseStatus = "Pending" | "Available" | "Reversed";

export interface ReferralUse {
  order: OrderRec;
  /** Net credit this order gives the owner right now (pending or available). */
  creditCents: number;
  /** Credit it gave before any reversal (the highest it reached). */
  grossCents: number;
  status: UseStatus;
}

/** Every order placed with this owner's code, newest first, with the credit it earned. */
export function referralUses(data: Pick<AppData, "orders" | "pendingOrders" | "creditEntries">, ownerId: string): ReferralUse[] {
  const entries = (data.creditEntries ?? []).filter((e) => e.customerId === ownerId && e.kind === "referral" && e.orderId);
  const byOrder = new Map<string, CreditEntryRec[]>();
  for (const e of entries) byOrder.set(e.orderId!, [...(byOrder.get(e.orderId!) ?? []), e]);
  const orders = [...data.orders, ...(data.pendingOrders ?? [])].filter((o) => o.referredById === ownerId || byOrder.has(o.id));
  return orders
    .map((order) => {
      const es = byOrder.get(order.id) ?? [];
      const pending = es.filter((e) => e.pending).reduce((x, e) => x + e.amountCents, 0);
      const available = es.filter((e) => !e.pending).reduce((x, e) => x + e.amountCents - (e.shortfallCents || 0), 0);
      const grossCents = Math.max(0, ...es.filter((e) => e.amountCents > 0).map((e) => e.amountCents));
      const status: UseStatus = pending > 0 ? "Pending" : available > 0 ? "Available" : "Reversed";
      return { order, creditCents: pending > 0 ? pending : available, grossCents, status };
    })
    .sort((a, b) => (b.order.createdAt < a.order.createdAt ? -1 : b.order.createdAt > a.order.createdAt ? 1 : 0));
}

export interface ReferralSummary {
  uses: number;
  /** Referral credit earned that is (or became) spendable, net of reversals. */
  earnedCents: number;
  pendingCents: number;
  /** Spendable store credit balance (all kinds). Negative after a reversal of spent credit. */
  balanceCents: number;
  negative: boolean;
}

export function referralSummary(data: Pick<AppData, "orders" | "pendingOrders" | "creditEntries">, ownerId: string): ReferralSummary {
  const entries = data.creditEntries ?? [];
  const uses = referralUses(data, ownerId);
  const earnedCents = entries.filter((e) => e.customerId === ownerId && e.kind === "referral" && !e.pending).reduce((x, e) => x + e.amountCents - (e.shortfallCents || 0), 0);
  const balanceCents = balanceOf(entries, ownerId);
  return { uses: uses.length, earnedCents, pendingCents: pendingOf(entries, ownerId), balanceCents, negative: balanceCents < 0 };
}

/** What the buyer paid on a use (for admin only). */
export const useTotal = (o: OrderRec) => orderTotals(o).total;
