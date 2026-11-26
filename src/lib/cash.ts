// Cash tracking: where business money sits. Pure.
// Each in-person sale is assigned to whoever received the money (picked on the Sell screen: Ahmad, Mo or the
// bank, any payment method); each paid website order to whoever online payments went to when it was paid. Refunds lower the same holder (the order total drops). Hand-offs move money
// between Ahmad, Mo and the bank. Expenses come out of whoever paid them. Business money never changes here: Bank is simply whatever
// business money is not held as cash by a partner.
import { fmtMoney } from "./format";
import type { Ledger } from "./money";
import type { AppData, CashHandoffRec, CashHolder, OrderRec, Partner } from "./types";

export const isCash = (method: string | null | undefined) => (method ?? "").trim().toLowerCase() === "cash";

/**
 * Who holds the money from this sale (null = the bank).
 * In person: "Money received by" on the sale (cashTo), whatever the payment method (Zelle to Mo counts for Mo).
 * Not recorded (older sales) or Bank = the bank. Website: who online payments went to (Settings > Payments),
 * saved on the order when it was marked paid.
 */
export const cashHolderOf = (o: Pick<OrderRec, "cashTo" | "source"> & { paidTo?: Partner | null; paymentMethod?: string }): Partner | null =>
  o.source === "inperson" ? (o.cashTo === "A" || o.cashTo === "B" ? o.cashTo : null) : o.paidTo ?? null;

/** Who received the money of an order, for display: "A" | "B" | "bank". */
export const moneyHolderOf = (o: Pick<OrderRec, "cashTo" | "source"> & { paidTo?: Partner | null }): CashHolder => cashHolderOf(o) ?? "bank";

export interface CashPosition {
  /** Cash each partner holds now (received + handed to them - handed away). */
  A: number;
  B: number;
  /** Business money not held as cash by a partner. */
  bank: number;
  /** Cash received from sales, per partner (before hand-offs). */
  received: Record<Partner, number>;
  /** Business money (A + B + bank). */
  total: number;
}

export function cashPosition(data: Pick<AppData, "orders" | "cashHandoffs" | "expenses">, ledger: Pick<Ledger, "businessCents" | "orders">): CashPosition {
  const received: Record<Partner, number> = { A: 0, B: 0 };
  for (const o of data.orders) {
    const who = cashHolderOf(o);
    if (!who) continue;
    received[who] += ledger.orders.get(o.id)?.total ?? 0;
  }
  const held: Record<CashHolder, number> = { A: received.A, B: received.B, bank: 0 };
  for (const h of data.cashHandoffs ?? []) {
    held[h.from] -= h.amountCents;
    held[h.to] += h.amountCents;
  }
  // An expense comes out of whoever paid it. Paid by the bank: business money drops, so Bank (the rest) drops.
  for (const x of data.expenses ?? []) if (x.amountCents > 0 && x.paidBy !== "bank") held[x.paidBy] -= x.amountCents;
  return { A: held.A, B: held.B, bank: ledger.businessCents - held.A - held.B, received, total: ledger.businessCents };
}

/** Why a hand-off can't be saved ("" = fine). `pos` is the position before it. */
export function handoffError(h: Pick<CashHandoffRec, "from" | "to" | "amountCents">, pos: CashPosition): string {
  if (h.from === h.to) return "Pick two different places.";
  if (!(h.amountCents > 0)) return "Enter how much cash moved.";
  if (h.from !== "bank" && h.amountCents > pos[h.from]) return `That is more than the ${fmtMoney(Math.max(0, pos[h.from]))} held there.`;
  return "";
}
