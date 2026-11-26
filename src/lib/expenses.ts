// Expense totals for a period (Money > Performance). Pure.
import { dayKey } from "./format";
import type { ExpenseRec } from "./types";

export interface PeriodExpenses {
  /** Every expense in the period. Counts as cost and comes off profit. */
  total: number;
  /** Lab testing only ("Testing spent"). */
  testing: number;
  count: number;
  /** Total per local day (yyyy-mm-dd), for the daily profit chart. */
  byDay: Map<string, number>;
}

export function periodExpenses(list: ExpenseRec[], inRange: (iso: string) => boolean = () => true): PeriodExpenses {
  const out: PeriodExpenses = { total: 0, testing: 0, count: 0, byDay: new Map() };
  for (const x of list) {
    if (!(x.amountCents > 0) || !inRange(x.date)) continue;
    out.total += x.amountCents;
    out.count++;
    if (x.category === "lab_testing") out.testing += x.amountCents;
    const k = dayKey(x.date);
    out.byDay.set(k, (out.byDay.get(k) ?? 0) + x.amountCents);
  }
  return out;
}
