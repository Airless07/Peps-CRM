// Restock orders: save, edit, delete. Each line is a Purchase row (restockOrderId = the order), so stock and
// business money come out of the same math as every restock, and cash held comes out of whoever paid.
// Each size's cost per vial is set to the weighted average with the stock already there; an edit or a
// delete takes the old units out at their cost first, so it adjusts by the difference.
// Every change writes a RestockEvent (kept after a delete).
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { HttpError } from "./api";
import { prisma } from "./db";
import { fmtMoney } from "./format";
import { computeLedger, type Ledger } from "./money";
import { costAfter, planRestock, type RestockPlan } from "./restock";
import type { restockInput } from "./schemas";
import { loadAll, toRestockOrder } from "./serialize";
import type { CashHolder, RestockOrderRec } from "./types";
import { removeUpload } from "./uploads";

export type RestockInput = z.output<typeof restockInput>;
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Line = { productId: string; quantity: number; costCents: number };

function plan(input: RestockInput): RestockPlan {
  const p = planRestock(input.lines, input);
  if (p.error) throw new HttpError(400, p.error);
  return p;
}

async function checkProducts(ids: string[]) {
  const found = await prisma.product.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true } });
  if (found.length !== new Set(ids).size) throw new HttpError(400, "A product in this order no longer exists. Reload the page.");
}

/**
 * New cost per vial for every product touched: take out the old lines (edit/delete), add the new ones,
 * weighted with the stock there now. Returns the changes, for the log.
 */
async function updateCosts(tx: Tx, ledger: Ledger, oldLines: Line[], newLines: Line[]) {
  const sum = (lines: Line[], id: string) => lines.filter((l) => l.productId === id).reduce((a, l) => ({ qty: a.qty + l.quantity, cents: a.cents + l.costCents }), { qty: 0, cents: 0 });
  const ids = [...new Set([...oldLines, ...newLines].map((l) => l.productId))];
  const products = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, costOverrideCents: true } });
  const changes: string[] = [];
  for (const p of products) {
    const st = ledger.stock.get(p.id);
    const before = st?.unitCost ?? 0;
    // The ledger was read before this change: the old lines are in its stock, the new ones are not.
    const after = costAfter(st?.stock ?? 0, before, sum(oldLines, p.id), sum(newLines, p.id));
    if (after !== p.costOverrideCents) await tx.product.update({ where: { id: p.id }, data: { costOverrideCents: after } });
    if (after !== before) changes.push(`${p.name} cost ${fmtMoney(before)} → ${fmtMoney(after)}/vial`);
  }
  return changes;
}

async function names() {
  const s = await prisma.settings.findUnique({ where: { id: 1 }, select: { partnerAName: true, partnerBName: true } });
  return (h: CashHolder) => (h === "bank" ? "Bank" : h === "A" ? s?.partnerAName || "Partner A" : s?.partnerBName || "Partner B");
}

const orderRow = (x: RestockInput) => ({
  name: x.name,
  date: x.date,
  supplier: x.supplier,
  lot: x.lot,
  notes: x.notes,
  paidBy: x.paidBy,
  shippingCents: x.shippingCents,
  shippingDiscountCents: x.shippingDiscountCents,
  discountCents: x.discountCents,
  feeMode: x.feeMode,
  feeValue: x.feeValue,
  file: x.file,
  fileName: x.file ? x.fileName : "",
  mime: x.file ? x.mime : "",
});

async function writeLines(tx: Tx, orderId: string, x: RestockInput, p: RestockPlan) {
  const now = Date.now();
  for (const [i, l] of p.lines.entries()) {
    await tx.purchase.create({
      data: {
        id: randomUUID(),
        date: x.date,
        productId: l.productId,
        quantity: l.quantity,
        totalCostCents: l.costCents,
        listCents: l.lineCents,
        note: `Restock: ${x.name}${x.lot ? ` · lot ${x.lot}` : ""}${l.free ? " · free" : ""}`,
        fromInvestment: false,
        paidBy: x.paidBy,
        restockOrderId: orderId,
        // Keep the lines in the order they were added.
        createdAt: new Date(now + i),
      },
    });
  }
}

const log = (tx: Tx, restockId: string, action: "created" | "edited" | "deleted", message: string, detail: unknown) =>
  tx.restockEvent.create({ data: { id: randomUUID(), restockId, action, message, detail: JSON.stringify(detail) } });

export async function createRestock(id: string, input: RestockInput): Promise<RestockOrderRec> {
  const p = plan(input);
  await checkProducts(p.lines.map((l) => l.productId));
  const name = await names();
  // Stock and cost now (read before the transaction: the new lines are not in it yet).
  const ledger = computeLedger(await loadAll());
  return prisma.$transaction(
    async (tx) => {
      if (await tx.restockOrder.findUnique({ where: { id } })) throw new HttpError(409, "This restock was already saved.");
      const order = await tx.restockOrder.create({ data: { id, ...orderRow(input) } });
      const costs = await updateCosts(tx, ledger, [], p.lines);
      await writeLines(tx, id, input, p);
      const units = p.lines.reduce((a, l) => a + l.quantity, 0);
      await log(tx, id, "created", `Saved "${input.name}": ${p.lines.length} lines, ${units} vials, ${fmtMoney(p.totalCents)} paid by ${name(input.paidBy)}.${costs.length ? ` ${costs.join("; ")}.` : ""}`, { order, lines: p.lines });
      return toRestockOrder(order);
    },
    { timeout: 30_000 },
  );
}

async function current(tx: Tx, id: string) {
  const order = await tx.restockOrder.findUnique({ where: { id } });
  if (!order) throw new HttpError(404, "That restock no longer exists. Reload the page.");
  const lines = await tx.purchase.findMany({ where: { restockOrderId: id }, orderBy: { createdAt: "asc" } });
  return { order, lines, total: lines.reduce((a, l) => a + l.totalCostCents, 0) };
}

export async function updateRestock(id: string, input: RestockInput): Promise<RestockOrderRec> {
  const p = plan(input);
  await checkProducts(p.lines.map((l) => l.productId));
  const name = await names();
  const ledger = computeLedger(await loadAll());
  const { saved, oldFile } = await prisma.$transaction(
    async (tx) => {
      const old = await current(tx, id);
      const oldLines = old.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, costCents: l.totalCostCents }));
      const costs = await updateCosts(tx, ledger, oldLines, p.lines);
      await tx.purchase.deleteMany({ where: { restockOrderId: id } });
      await writeLines(tx, id, input, p);
      const order = await tx.restockOrder.update({ where: { id }, data: { ...orderRow(input), updatedAt: new Date() } });
      const diff: string[] = [];
      if (old.total !== p.totalCents) diff.push(`total ${fmtMoney(old.total)} → ${fmtMoney(p.totalCents)}`);
      if (old.order.paidBy !== input.paidBy) diff.push(`paid by ${name(old.order.paidBy as CashHolder)} → ${name(input.paidBy)}`);
      const units = (ls: { quantity: number }[]) => ls.reduce((a, l) => a + l.quantity, 0);
      if (units(old.lines) !== units(p.lines)) diff.push(`vials ${units(old.lines)} → ${units(p.lines)}`);
      if (old.order.name !== input.name) diff.push(`name "${old.order.name}" → "${input.name}"`);
      await log(tx, id, "edited", `Edited "${input.name}"${diff.length ? `: ${diff.join("; ")}` : ""}.${costs.length ? ` ${costs.join("; ")}.` : ""}`, { order, lines: p.lines, before: old });
      return { saved: toRestockOrder(order), oldFile: old.order.file !== order.file ? old.order.file : "" };
    },
    { timeout: 30_000 },
  );
  if (oldFile) await removeUpload(oldFile, "private");
  return saved;
}

export async function deleteRestock(id: string): Promise<void> {
  const name = await names();
  const ledger = computeLedger(await loadAll());
  const file = await prisma.$transaction(
    async (tx) => {
      const old = await current(tx, id);
      const oldLines = old.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, costCents: l.totalCostCents }));
      const costs = await updateCosts(tx, ledger, oldLines, []);
      await tx.purchase.deleteMany({ where: { restockOrderId: id } });
      await tx.restockOrder.delete({ where: { id } });
      await log(tx, id, "deleted", `Deleted "${old.order.name}": ${old.lines.length} lines, ${fmtMoney(old.total)} paid by ${name(old.order.paidBy as CashHolder)} reversed.${costs.length ? ` ${costs.join("; ")}.` : ""}`, old);
      return old.order.file;
    },
    { timeout: 30_000 },
  );
  if (file) await removeUpload(file, "private");
}
