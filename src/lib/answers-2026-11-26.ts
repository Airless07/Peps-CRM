// One-time fix: the owner's answers to the restock check (2026-11-26). Runs once at startup (DataMigration row);
// each part only changes a record that is exactly as found, and every old value is kept in the row's detail.
//  1. The first restock ($1,300 starting balance, Nov 13) was paid by Ahmad: cash held puts it on Ahmad.
//  2. Everything on Nov 13 (Tesa included) was bought with that $1,300; the Nov 22 KLOW "restock" of 10 at $0
//     was a count correction (20 were received, 10 entered): it becomes a +10 stock correction. No money moves.
//  4. #1004 ($130 Zelle): money received by Mo.
//  5. Cost per vial for future sales: this shipment's costs (past sales keep their recorded cost).
//  6. Nov 13 entries tagged "Batch #1 (shipment 1)", lot BL2611.
// Stock per size does not change (the KLOW +10 stays +10, now as a correction).
import { randomUUID } from "node:crypto";
import { prisma } from "./db";

export const ANSWERS_ID = "answers-2026-11-26";
export const SHIP1 = "Batch #1 (shipment 1) · lot BL2611 · paid by Ahmad";

const NOV13 = [
  "b905bc58-acc1-4991-b26b-7131626ffb59", "dd708fb6-294c-4289-86ad-7613823e8057", "3c187514-86cb-479f-9b2e-b50cc1da329f", "e5ebb3d9-9ee4-40f9-9fe5-377c0191e85c",
  "9c4663df-ec10-44b1-8793-2501c9412404", "8cc060f6-1b96-46f8-b2ef-c359bdf6d025", "7782149b-7860-4bbe-a62d-82df39690c68", "db54cc92-4009-434d-9dd0-b72de7b854cb",
  "f0a15172-0813-4edb-8dc9-4dc7838fb8dd", "61964ac0-7169-493d-bcb9-de08905490b8", "bc65117f-500c-45dc-90c3-cc3d3009a3e1", "3b423e3a-909e-46d8-b0c5-4b6e36fce05f",
];
const KLOW_NOV22 = "7def3b2d-777e-448c-aa04-c85e4240b523";
const KLOW = "2def801b-0233-43c8-8a10-c66276cc6446";

/** Answer 5: cost per vial for future sales (this shipment's costs). */
export const NEW_COSTS: Record<string, number> = {
  "e9ce7018-19e6-430b-ae59-58b0eb8826e0": 890, // Retatrutide 10mg
  "bb00b46d-b608-459f-a67d-7da5eff81d53": 1466, // Retatrutide 20mg
  [KLOW]: 1990, // KLOW 80mg
  "68b6555d-027c-4e86-a75e-68e20d6396f9": 681, // MOTS-c 10mg
  "b7ec3b10-80ea-4c93-be14-5f74ee9c3b25": 943, // MOTS-C 20mg
  "d6866910-01ea-4474-9af9-b490ff1981b9": 524, // GHK-Cu 100mg
  "ed5201fe-1b2a-4041-b684-73eb3c565083": 419, // MT-2 10mg
  "46e8989d-94c7-4f9c-a0b7-37e7cec81d98": 1047, // CJC-1295 + Ipamorelin
  "cd7b78a9-8537-4de6-9f28-c854eb3cf5e7": 628, // KPV 10mg
  "d39c561b-9d67-4d86-ac70-a26cc1085a8c": 105, // BUCK H2O 10ml
};

export async function applyAnswers20261126(): Promise<string[] | null> {
  return prisma.$transaction(async (tx) => {
    if (await tx.dataMigration.findUnique({ where: { id: ANSWERS_ID } })) return null;
    const log: string[] = [];
    const before: Record<string, unknown> = {};

    // 1. Starting balance (first restock) paid by Ahmad.
    const s = await tx.settings.findUnique({ where: { id: 1 } });
    before.settings = s && { startingBalanceCents: s.startingBalanceCents, startingPaidBy: s.startingPaidBy };
    if (s && s.startingBalanceCents === -130000 && !s.startingPaidBy) {
      await tx.settings.update({ where: { id: 1 }, data: { startingPaidBy: "A" } });
      log.push("first restock ($1,300 starting balance) paid by Ahmad");
    } else log.push("starting balance not as found, left alone");

    // 2 + 6. Nov 13 entries: Batch #1 (shipment 1), paid by Ahmad, all inside the $1,300 (Tesa too).
    const nov13 = await tx.purchase.findMany({ where: { id: { in: NOV13 } } });
    before.nov13 = nov13;
    let tagged = 0;
    for (const p of nov13) {
      if (p.totalCostCents !== 0 || p.note !== "" || p.paidBy) continue;
      await tx.purchase.update({ where: { id: p.id }, data: { note: SHIP1, paidBy: "A", fromInvestment: true } });
      tagged++;
    }
    log.push(`${tagged} of ${NOV13.length} Nov 13 entries tagged Batch #1 (shipment 1), paid by Ahmad`);

    // 2 + 6. Nov 22 KLOW +10 at $0: a count correction of shipment 1, not a purchase.
    const k = await tx.purchase.findUnique({ where: { id: KLOW_NOV22 } });
    before.klowNov22 = k;
    if (k && k.productId === KLOW && k.quantity === 10 && k.totalCostCents === 0 && !k.restockOrderId) {
      await tx.stockAdjustment.create({
        data: { id: randomUUID(), date: k.date, productId: KLOW, quantity: 10, reason: "correction", lot: "BL2611", note: "Batch #1 (shipment 1): count correction, 20 KLOW were received but 10 were entered (was a $0 restock of 10 on Nov 22)" },
      });
      await tx.purchase.delete({ where: { id: KLOW_NOV22 } });
      log.push("Nov 22 KLOW +10 is now a stock correction of Batch #1 (shipment 1)");
    } else log.push("Nov 22 KLOW entry not as found, left alone");

    // 4. #1004: money received by Mo.
    const o = await tx.order.findFirst({ where: { number: 1004 }, select: { id: true, source: true, cashTo: true } });
    before.order1004 = o;
    if (o && o.source === "inperson" && !o.cashTo) {
      await tx.order.update({ where: { id: o.id }, data: { cashTo: "B" } });
      await tx.orderEvent.create({ data: { id: randomUUID(), orderId: o.id, kind: "note", message: "Money received by changed: Not recorded → Mo.", detail: "Paid by Zelle to Mo. Cash held only. Business money and the split are unchanged." } });
      log.push("#1004: money received by Mo");
    } else log.push("#1004 not as found, left alone");

    // 5. Cost per vial for future sales.
    const prods = await tx.product.findMany({ where: { id: { in: Object.keys(NEW_COSTS) } }, select: { id: true, name: true, costOverrideCents: true } });
    before.costs = prods;
    for (const p of prods) await tx.product.update({ where: { id: p.id }, data: { costOverrideCents: NEW_COSTS[p.id] } });
    log.push(`cost per vial updated for ${prods.length} sizes`);

    await tx.dataMigration.create({ data: { id: ANSWERS_ID, detail: JSON.stringify({ log, before }) } });
    return log;
  });
}
