// One-time fix: the restock of 2026-11-26 is "Batch #1 (shipment 2)", lot BL2611, paid entirely by Ahmad.
// Supplier order: products $1,665, shipping $100 waived, discounts -$3 and -$1, Zelle fee $83: $1,744 paid.
// The fee and discounts are spread over the paid lines (line x 1744/1665); the free RT10 vial costs $0.
//
// What was entered one by one, and what this fixes (nothing is deleted except the duplicate fee expense,
// whose delete is logged in the expense history; every old value is saved in the DataMigration row):
//  - costs were the pre-fee line totals ($1,665): each line gets its share of $1,744
//  - Retatrutide 20mg was 20 vials for $140 + 1 vial for $140 (+ a -1 correction): 20 vials, $280 share
//  - the free Retatrutide 10mg vial was missing: the extra 1-vial entry becomes that free vial ($0), and a
//    +1 Retatrutide 20mg correction undoes the -1 that only existed to cancel the extra vial
//  - the $83 Zelle fee was also entered as an expense ("Zelle peps", paid by Ahmad): it is inside the
//    $1,744 now, so that expense is deleted (logged) to not count it twice
//  - no "paid by": every line is now paid by Ahmad; notes name the batch, lot and supplier code
// Runs only if every record is exactly as found on 2026-11-26; otherwise it changes nothing and says why.
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { toExpense } from "./serialize";

export const BATCH1_SHIP2_ID = "batch1-shipment2-bl2611";
export const LOT = "BL2611";
export const BATCH = "Batch #1 (shipment 2)";
export const PAID_TOTAL = 174400;

const P = {
  rt10: "e9ce7018-19e6-430b-ae59-58b0eb8826e0",
  rt20: "bb00b46d-b608-459f-a67d-7da5eff81d53",
  klow: "2def801b-0233-43c8-8a10-c66276cc6446",
  ms10: "68b6555d-027c-4e86-a75e-68e20d6396f9",
  ms20: "b7ec3b10-80ea-4c93-be14-5f74ee9c3b25",
  ghk: "d6866910-01ea-4474-9af9-b490ff1981b9",
  mt2: "ed5201fe-1b2a-4041-b684-73eb3c565083",
  cjc: "46e8989d-94c7-4f9c-a0b7-37e7cec81d98",
  kpv: "cd7b78a9-8537-4de6-9f28-c854eb3cf5e7",
  buck: "d39c561b-9d67-4d86-ac70-a26cc1085a8c",
};

/** The supplier order, in order. `line` = what the supplier charged for the line (cents, before fee/discounts). */
export const ORDER = [
  { code: "RT10", purchase: "3f6496bf-f757-4513-82a2-a41477edca8d", productId: P.rt10, qty: 20, line: 17000, was: { productId: P.rt10, qty: 20, cost: 17000 } },
  { code: "RT20", purchase: "39f7e84d-8b6d-4350-9e8c-326cadf04c9c", productId: P.rt20, qty: 20, line: 28000, was: { productId: P.rt20, qty: 20, cost: 14000 } },
  { code: "KL80", purchase: "71f0914d-8506-44ad-8f2c-7088885f8c83", productId: P.klow, qty: 20, line: 38000, was: { productId: P.klow, qty: 20, cost: 38000 } },
  { code: "MS10", purchase: "469e4b06-4ee6-438b-9345-c802255f7eb3", productId: P.ms10, qty: 10, line: 6500, was: { productId: P.ms10, qty: 10, cost: 6500 } },
  { code: "MS20", purchase: "6bc18d2e-3b09-47d8-964c-32f4fea8c73a", productId: P.ms20, qty: 20, line: 18000, was: { productId: P.ms20, qty: 20, cost: 18000 } },
  { code: "CU100", purchase: "d1b85745-b6cd-4f4f-a987-91c4aa521e80", productId: P.ghk, qty: 20, line: 10000, was: { productId: P.ghk, qty: 20, cost: 10000 } },
  { code: "MT-2", purchase: "909d5134-255a-4283-8a87-6c37958975cf", productId: P.mt2, qty: 20, line: 8000, was: { productId: P.mt2, qty: 20, cost: 8000 } },
  { code: "CP10", purchase: "bc1ad911-054c-473e-89a6-543e5455aa54", productId: P.cjc, qty: 30, line: 30000, was: { productId: P.cjc, qty: 30, cost: 30000 } },
  { code: "KP10", purchase: "9bcd460b-d798-4b99-add0-9acdc5096279", productId: P.kpv, qty: 10, line: 6000, was: { productId: P.kpv, qty: 10, cost: 6000 } },
  { code: "BA10", purchase: "22784ed7-169d-4267-8964-bfc8a3693cbc", productId: P.buck, qty: 50, line: 5000, was: { productId: P.buck, qty: 50, cost: 5000 } },
  // The free vial. Entered as "Retatrutide 20mg, 1 vial, $140" (then cancelled with a -1 correction).
  { code: "RT10 free", purchase: "46f074f5-8bdb-42e1-a5c5-56a5fa3caddc", productId: P.rt10, qty: 1, line: 0, was: { productId: P.rt20, qty: 1, cost: 14000 } },
] as const;
const RT20_MINUS_ONE = "ee21dff3-b8c8-4e9e-a773-8003dbe24ded";
const FEE_EXPENSE = "9daaee72-2dc3-4d07-a073-8f0ad933505e";

/**
 * Spread `paid` over the lines in proportion to each line (largest remainder, integer cents): the shares
 * add up to exactly `paid`. A $0 line gets $0.
 */
export function spread(lines: number[], paid: number): number[] {
  const sum = lines.reduce((a, b) => a + b, 0);
  if (sum <= 0) return lines.map(() => 0);
  const raw = lines.map((l) => (l * paid) / sum);
  const out = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - out[i], i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0, left = paid - out.reduce((a, b) => a + b, 0); k < left; k++) out[order[k][1]]++;
  return out;
}

export interface Ship2Result {
  applied: boolean;
  why: string;
  lines?: { code: string; qty: number; costCents: number; unitCents: number }[];
}

export async function fixBatch1Shipment2(): Promise<Ship2Result | null> {
  return prisma.$transaction(async (tx) => {
    if (await tx.dataMigration.findUnique({ where: { id: BATCH1_SHIP2_ID } })) return null;
    const done = async (r: Ship2Result, before: unknown = null) => {
      await tx.dataMigration.create({ data: { id: BATCH1_SHIP2_ID, detail: JSON.stringify({ ...r, before }) } });
      return r;
    };
    // Every record must be exactly as found. Anything else: change nothing.
    const found = await tx.purchase.findMany({ where: { id: { in: ORDER.map((l) => l.purchase) } } });
    const byId = new Map(found.map((p) => [p.id, p]));
    for (const l of ORDER) {
      const p = byId.get(l.purchase);
      if (!p) return done({ applied: false, why: `restock line ${l.code} (${l.purchase}) is missing, nothing changed` });
      if (p.productId !== l.was.productId || p.quantity !== l.was.qty || p.totalCostCents !== l.was.cost || p.fromInvestment || p.paidBy)
        return done({ applied: false, why: `restock line ${l.code} was edited since (${p.quantity} for ${p.totalCostCents}c), nothing changed` });
    }
    const minus = await tx.stockAdjustment.findUnique({ where: { id: RT20_MINUS_ONE } });
    if (!minus || minus.productId !== P.rt20 || minus.quantity !== -1) return done({ applied: false, why: "the Retatrutide 20mg -1 correction is not as found, nothing changed" });
    const fee = await tx.expense.findUnique({ where: { id: FEE_EXPENSE } });
    const feeOk = !!fee && fee.amountCents === 8300 && fee.paidBy === "A";

    const costs = spread(ORDER.map((l) => l.line), PAID_TOTAL);
    const lines: NonNullable<Ship2Result["lines"]> = [];
    for (const [i, l] of ORDER.entries()) {
      const note = `${BATCH} · lot ${LOT} · ${l.code === "RT10 free" ? "RT10, free vial" : l.code} · paid by Ahmad`;
      await tx.purchase.update({ where: { id: l.purchase }, data: { productId: l.productId, quantity: l.qty, totalCostCents: costs[i], paidBy: "A", note } });
      lines.push({ code: l.code, qty: l.qty, costCents: costs[i], unitCents: Math.round(costs[i] / l.qty) });
    }
    const date = byId.get(ORDER[0].purchase)!.date;
    await tx.stockAdjustment.create({
      data: { id: randomUUID(), date, productId: P.rt20, quantity: 1, reason: "correction", note: `${BATCH}: undoes the -1 that cancelled an extra 1-vial Retatrutide 20mg entry (that entry is now the free Retatrutide 10mg vial)` },
    });
    if (feeOk) {
      const rec = toExpense(fee!);
      await tx.expense.delete({ where: { id: FEE_EXPENSE } });
      await tx.expenseEvent.create({
        data: { id: randomUUID(), expenseId: FEE_EXPENSE, action: "deleted", message: `Deleted: Other · Zelle peps · $83.00 · paid by Ahmad. The $83 Zelle fee is part of ${BATCH} ($1,744 paid by Ahmad), so it was counted twice.`, detail: JSON.stringify(rec) },
      });
    }
    const before = { purchases: found, minusOne: minus, feeExpense: fee };
    return done({ applied: true, why: `${BATCH} set to $1,744 paid by Ahmad, lot ${LOT}${feeOk ? "; duplicate $83 fee expense removed" : "; fee expense not found as expected, left alone"}`, lines }, before);
  });
}
