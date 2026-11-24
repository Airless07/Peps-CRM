// Cash tracking: where business money sits. Pure.
// Each in-person cash sale is assigned to the partner who received the cash; each paid website order to
// whoever receives its payment method (e.g. Zelle -> Mo). Refunds lower the same holder (the order total drops). Hand-offs move money
// between Ahmad, Mo and the bank. Business money never changes here: Bank is simply whatever
// business money is not held as cash by a partner.
import { fmtMoney } from "./format";
import type { Ledger } from "./money";
import type { AppData, CashHandoffRec, CashHolder, OrderRec, Partner } from "./types";

export const isCash = (method: string | null | undefined) => (method ?? "").trim().toLowerCase() === "cash";

/**
 * Who holds the money from this sale (null = the bank).
 * In person: the partner who received the cash (cash sales only). Website: whoever receives that payment
 * method (Settings > Payments), saved on the order when it was marked paid.
 */
export const cashHolderOf = (o: Pick<OrderRec, "paymentMethod" | "cashTo" | "source"> & { paidTo?: Partner | null }): Partner | null =>
  o.source === "inperson" ? (isCash(o.paymentMethod) && o.cashTo ? o.cashTo : null) : o.paidTo ?? null;

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

export function cashPosition(data: Pick<AppData, "orders" | "cashHandoffs">, ledger: Pick<Ledger, "businessCents" | "orders">): CashPosition {
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
  return { A: held.A, B: held.B, bank: ledger.businessCents - held.A - held.B, received, total: ledger.businessCents };
}

/** Why a hand-off can't be saved ("" = fine). `pos` is the position before it. */
export function handoffError(h: Pick<CashHandoffRec, "from" | "to" | "amountCents">, pos: CashPosition): string {
  if (h.from === h.to) return "Pick two different places.";
  if (!(h.amountCents > 0)) return "Enter how much cash moved.";
  if (h.from !== "bank" && h.amountCents > pos[h.from]) return `That is more than the ${fmtMoney(Math.max(0, pos[h.from]))} held there.`;
  return "";
}
