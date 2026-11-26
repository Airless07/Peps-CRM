// Expense totals for a period (Money > Performance). Pure.
import { dayKey } from "./format";
import type { AdjustmentRec, ExpenseRec } from "./types";

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

export interface TestingSummary {
  rows: AdjustmentRec[];
  vials: number;
  /** Cost of the vials sent (kept on each adjustment at the time). Not money spent: reported as "Testing cost". */
  costCents: number;
}

/** Vials sent for lab testing in a period, newest first, with their total vials and cost. */
export function testingSummary(adjustments: AdjustmentRec[], inRange: (iso: string) => boolean = () => true): TestingSummary {
  const rows = adjustments.filter((a) => a.reason === "lab_testing" && inRange(a.date)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return { rows, vials: rows.reduce((x, a) => x + Math.max(0, -a.quantity), 0), costCents: rows.reduce((x, a) => x + (a.costCents ?? 0), 0) };
}
