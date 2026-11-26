// Lab testing: vials taken out of stock and sent to a lab. They were paid for at restock, so this never
// touches business money or cash held. Their cost (cost per vial at the time x vials) is kept on the
// adjustment and reported as "Testing cost" in Performance, apart from sales cost and breakage.
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { HttpError } from "./api";
import { prisma } from "./db";
import { computeLedger } from "./money";
import type { adjustmentCreate, adjustmentUpdate, labShipmentInput } from "./schemas";
import { loadAll } from "./serialize";

/** Cost per vial of each size now (the same number the Sell screen uses). */
async function unitCosts(): Promise<Map<string, number>> {
  const ledger = computeLedger(await loadAll());
  return new Map([...ledger.stock].map(([id, st]) => [id, st.unitCost]));
}

const testingCost = (reason: string, quantity: number, unit: number) => (reason === "lab_testing" && quantity < 0 ? -quantity * unit : 0);
const labOnly = <T extends { reason?: string; lab?: string; sampleId?: string; lot?: string; expenseId?: string | null }>(a: T) =>
  a.reason === "lab_testing" ? a : { ...a, lab: "", sampleId: "", lot: "", expenseId: null };

export async function createAdjustment(input: z.output<typeof adjustmentCreate>) {
  const unit = (await unitCosts()).get(input.productId) ?? 0;
  return prisma.stockAdjustment.create({ data: { ...labOnly(input), costCents: testingCost(input.reason, input.quantity, unit) } });
}

export async function updateAdjustment(id: string, patch: z.output<typeof adjustmentUpdate>) {
  const old = await prisma.stockAdjustment.findUnique({ where: { id } });
  if (!old) throw new HttpError(404, "That adjustment no longer exists. Reload the page.");
  const next = { ...old, ...patch };
  if (next.reason === "lab_testing" && next.quantity >= 0) throw new HttpError(400, "Lab testing removes vials from stock.");
  // Keep the cost per vial it was saved with (the cost then), unless the size changed.
  const kept = next.productId === old.productId && old.costCents > 0 && old.quantity < 0 ? old.costCents / -old.quantity : null;
  const unit = kept ?? (await unitCosts()).get(next.productId) ?? 0;
  const lab = next.reason === "lab_testing" ? {} : { lab: "", sampleId: "", lot: "", expenseId: null, shipmentId: null };
  return prisma.stockAdjustment.update({ where: { id }, data: { ...patch, ...lab, costCents: Math.round(testingCost(next.reason, next.quantity, unit)) } });
}

/** "Send samples to lab": one row per size, all in one go (one shipment id). */
export async function sendLabShipment(input: z.output<typeof labShipmentInput>) {
  const ids = [...new Set(input.rows.map((r) => r.productId))];
  const found = await prisma.product.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw new HttpError(400, "A product in this shipment no longer exists. Reload the page.");
  const costs = await unitCosts();
  const now = Date.now();
  return prisma.$transaction(
    input.rows.map((r, i) =>
      prisma.stockAdjustment.create({
        data: {
          id: randomUUID(),
          date: input.date,
          productId: r.productId,
          quantity: -r.quantity,
          reason: "lab_testing",
          note: input.note,
          lab: input.lab,
          lot: input.lot,
          sampleId: r.sampleId,
          expenseId: input.expenseId,
          shipmentId: input.id,
          costCents: r.quantity * (costs.get(r.productId) ?? 0),
          createdAt: new Date(now + i),
        },
      }),
    ),
  );
}
