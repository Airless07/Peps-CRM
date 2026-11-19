// In-person sales and saved (open) orders: database operations.
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { HttpError } from "./api";
import { ensureOrderCustomer } from "./customer-ops";
import { prisma } from "./db";
import { nextOrderNumber } from "./order-ops";
import type { orderInput, savedOrderInput } from "./schemas";
import { withLowStockAlert } from "./stock-alerts";

type Tx = Prisma.TransactionClient;
export type SaleInput = z.output<typeof orderInput>;
export type SavedOrderInput = z.output<typeof savedOrderInput>;

/**
 * Record an in-person sale (the Sell screen). It gets the next order number.
 * `fromSavedId`: the sale completes that saved order, which is removed in the same transaction.
 * If the saved order is already gone (completed or deleted on another device) nothing is recorded,
 * so one saved order can never become two sales.
 */
export async function recordSale(input: SaleInput, origin: string, fromSavedId?: string | null) {
  const { lines, ...order } = input;
  await withLowStockAlert(
    () =>
      prisma.$transaction(async (tx: Tx) => {
        if (fromSavedId) {
          const gone = await tx.savedOrder.deleteMany({ where: { id: fromSavedId } });
          if (gone.count === 0) throw new HttpError(409, "This saved order was already completed or deleted.");
        }
        const customer = await ensureOrderCustomer(tx, order.customerId, order.customer);
        await tx.order.create({
          data: {
            ...order,
            customer,
            number: await nextOrderNumber(tx),
            source: "inperson",
            status: "completed",
            lines: { create: lines.map((l, i) => ({ ...l, sortOrder: i })) },
          },
        });
      }),
    origin,
  );
}

/**
 * Save the cart for later, or update a saved order that was opened and saved again. Never touches money.
 * Its items are held out of stock while it is saved (computed in the ledger, src/lib/money.ts): deleting
 * it puts them back, completing it turns them into the sale. A hold can cross a low stock threshold, so
 * it sends the low stock alert like a sale does.
 */
export async function saveOrderForLater(input: SavedOrderInput, origin?: string) {
  return withLowStockAlert(() => saveNow(input), origin);
}

async function saveNow(input: SavedOrderInput) {
  const { id, lines, savedAt, ...rest } = input;
  // A sale with this id exists when a saved order was completed meanwhile: do not bring it back.
  if (await prisma.order.findUnique({ where: { id }, select: { id: true } })) throw new HttpError(409, "This order was already completed.");
  const data = { ...rest, linesJson: JSON.stringify(lines), savedAt: savedAt ?? new Date() };
  await prisma.savedOrder.upsert({ where: { id }, update: data, create: { id, ...data } });
}

export async function deleteSavedOrder(id: string) {
  await prisma.savedOrder.deleteMany({ where: { id } });
}
