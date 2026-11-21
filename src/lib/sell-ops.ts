// In-person sales and saved (open) orders: database operations.
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { HttpError } from "./api";
import { ensureOrderCustomer } from "./customer-ops";
import { prisma } from "./db";
import { nextOrderNumber } from "./order-ops";
import type { orderInput, savedOrderInput } from "./schemas";
import { withLowStockAlert } from "./stock-alerts";
import { isCash } from "./cash";
import { assertCreditAvailable, checkReferrer, rememberReferrer, syncOrderCredit } from "./credit-ops";
import { orderTotals } from "./money";

type Tx = Prisma.TransactionClient;
export type SaleInput = z.output<typeof orderInput>;
export type SavedOrderInput = z.output<typeof savedOrderInput>;

/**
 * The house rules every in-person sale is saved with, whatever the screen sent:
 * - Owner price: every line is charged its cost (revenue = cost, profit $0), with no discount, tip or deal.
 * - Cash: who received it is kept only for cash sales (the seller when not picked).
 */
export function cleanSale<
  T extends Pick<SaleInput, "owner" | "cashTo" | "paymentMethod" | "soldBy" | "discountType" | "discountValue" | "tipCents" | "lines"> & { storeCreditCents?: number; customerId?: string | null },
>(s: T): T {
  const out = { ...s };
  if (out.owner) {
    out.discountType = "$";
    out.discountValue = 0;
    out.tipCents = 0;
    // Owner price: no store credit (and no referral reward, see creditTargets).
    if (out.storeCreditCents !== undefined) out.storeCreditCents = 0;
    out.lines = out.lines.map((l) => ({ ...l, unitPriceCents: l.unitCostCents, dealId: "", dealName: "", fullPriceCents: l.fullPriceCents ?? null }));
  }
  out.cashTo = isCash(out.paymentMethod) ? out.cashTo ?? (out.soldBy === "A" || out.soldBy === "B" ? out.soldBy : null) : null;
  // Credit belongs to a customer, and is never more than the total after discounts.
  if (out.storeCreditCents !== undefined) out.storeCreditCents = out.customerId ? orderTotals(out).credit : 0;
  return out;
}

/** Name of who did it, for the store credit history. */
export async function sellerName(tx: Tx, soldBy: string): Promise<string> {
  if (soldBy !== "A" && soldBy !== "B") return "Website";
  const s = await tx.settings.findUnique({ where: { id: 1 }, select: { partnerAName: true, partnerBName: true } });
  return (soldBy === "A" ? s?.partnerAName : s?.partnerBName) || `Partner ${soldBy}`;
}

/**
 * Record an in-person sale (the Sell screen). It gets the next order number.
 * `fromSavedId`: the sale completes that saved order, which is removed in the same transaction.
 * If the saved order is already gone (completed or deleted on another device) nothing is recorded,
 * so one saved order can never become two sales.
 */
export async function recordSale(input: SaleInput, origin: string, fromSavedId?: string | null) {
  const { lines, ...order } = cleanSale(input);
  await withLowStockAlert(
    () =>
      prisma.$transaction(async (tx: Tx) => {
        if (fromSavedId) {
          const gone = await tx.savedOrder.deleteMany({ where: { id: fromSavedId } });
          if (gone.count === 0) throw new HttpError(409, "This saved order was already completed or deleted.");
        }
        const customer = await ensureOrderCustomer(tx, order.customerId, order.customer);
        const referredById = await checkReferrer(tx, order.referredById, order.customerId);
        // The saved order (if any) was removed above, so its own hold no longer counts against it.
        await assertCreditAvailable(tx, order.customerId, order.storeCreditCents);
        await tx.order.create({
          data: {
            ...order,
            referredById,
            customer,
            number: await nextOrderNumber(tx),
            source: "inperson",
            status: "completed",
            lines: { create: lines.map((l, i) => ({ ...l, sortOrder: i })) },
          },
        });
        await rememberReferrer(tx, order.customerId, referredById);
        // Completed: the store credit used comes off the balance and the referrer earns their reward.
        await syncOrderCredit(tx, order.id, { by: await sellerName(tx, order.soldBy) });
        // One use of each BOGO deal the sale got (counts toward the deal's use limit).
        for (const dealId of new Set(lines.map((l) => l.dealId).filter(Boolean))) {
          const deal = await tx.promotion.findUnique({ where: { id: dealId }, select: { id: true } });
          if (deal) await tx.promotionUse.create({ data: { id: randomUUID(), promotionId: deal.id, orderId: order.id, email: "" } });
        }
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

async function saveNow(raw: SavedOrderInput) {
  const { id, lines, savedAt, ...rest } = raw;
  // Same credit rule as a sale: none on owner price or without a customer, never more than the total after discounts.
  rest.storeCreditCents = rest.owner || !rest.customerId ? 0 : orderTotals({ ...rest, lines }).credit;
  // A sale with this id exists when a saved order was completed meanwhile: do not bring it back.
  if (await prisma.order.findUnique({ where: { id }, select: { id: true } })) throw new HttpError(409, "This order was already completed.");
  // The credit is only held now; it comes off the balance when the order is completed.
  const known = rest.customerId ? await prisma.customer.findUnique({ where: { id: rest.customerId }, select: { id: true } }) : null;
  if (known) await assertCreditAvailable(prisma, rest.customerId, rest.storeCreditCents, id);
  else rest.storeCreditCents = 0;
  if (rest.referredById) rest.referredById = await checkReferrer(prisma, rest.referredById, rest.customerId);
  const data = { ...rest, linesJson: JSON.stringify(lines), savedAt: savedAt ?? new Date() };
  await prisma.savedOrder.upsert({ where: { id }, update: data, create: { id, ...data } });
}

export async function deleteSavedOrder(id: string) {
  await prisma.savedOrder.deleteMany({ where: { id } });
}
