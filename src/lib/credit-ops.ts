// Store credit and referral writes. Server only. Every change to a customer's balance goes through here.
//
// syncOrderCredit() makes an order's credit history match what the order is now (see creditTargets):
// completing / marking paid takes the credit used and pays referral rewards; canceling, deleting or
// editing the order writes the difference (refund, reversal, correction). It is safe to call any number
// of times: when nothing changed it writes nothing.
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { HttpError } from "./api";
import { availableCredit, creditTargets, planCreditSync, reservedCredit, type CreditWrite } from "./credit";
import { prisma } from "./db";
import { fmtMoney } from "./format";
import { parseStore } from "./store/config";
import { countsInMoney, type OrderStatus } from "./types";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export async function creditBalance(db: Db, customerId: string): Promise<number> {
  const r = await db.creditEntry.aggregate({ where: { customerId }, _sum: { amountCents: true } });
  return r._sum.amountCents ?? 0;
}

/** Credit held by saved Sell orders and unpaid website orders of this customer, except `exceptId`. */
export async function creditReserved(db: Db, customerId: string, exceptId?: string | null): Promise<number> {
  const [saved, pending] = await Promise.all([
    db.savedOrder.findMany({ where: { customerId, storeCreditCents: { gt: 0 } }, select: { id: true, customerId: true, storeCreditCents: true } }),
    db.order.findMany({ where: { customerId, status: "awaiting_payment", storeCreditCents: { gt: 0 } }, select: { id: true, customerId: true, storeCreditCents: true, status: true } }),
  ]);
  return reservedCredit({ savedOrders: saved, pendingOrders: pending.map((o) => ({ ...o, status: o.status as OrderStatus })) }, customerId, exceptId);
}

/** Balance and what is free to spend now (balance minus other open orders' holds). */
export async function creditAvailable(db: Db, customerId: string, exceptId?: string | null) {
  const [balance, reserved] = await Promise.all([creditBalance(db, customerId), creditReserved(db, customerId, exceptId)]);
  return { balance, reserved, available: availableCredit(balance, reserved) };
}

/** Refuse an order that picks more store credit than the customer can spend. */
export async function assertCreditAvailable(db: Db, customerId: string | null, creditCents: number, exceptId?: string | null) {
  if (!(creditCents > 0)) return;
  if (!customerId) throw new HttpError(400, "Store credit needs a saved customer. Pick the customer first.");
  const c = await db.customer.findUnique({ where: { id: customerId }, select: { name: true } });
  if (!c) throw new HttpError(400, "Store credit needs a saved customer. Pick the customer first.");
  const { available, reserved } = await creditAvailable(db, customerId, exceptId);
  if (creditCents > available) {
    throw new HttpError(
      409,
      `${c.name} has ${fmtMoney(available)} store credit available${reserved > 0 ? ` (${fmtMoney(reserved)} is held by other open orders)` : ""}, so ${fmtMoney(creditCents)} can't be used. Lower the store credit and try again.`,
    );
  }
}

async function referralSettings(db: Db) {
  const row = await db.settings.findUnique({ where: { id: 1 }, select: { storeJson: true } });
  return parseStore(row?.storeJson).referrals;
}

function reasonFor(w: CreditWrite, ctx: { number: number | null; why: string; customerName: string; percent: number }) {
  const ord = ctx.number ? `order #${ctx.number}` : "an order";
  if (w.kind === "order") return w.amountCents < 0 ? `Used on ${ord}` : `Refund: ${ord} ${ctx.why}`;
  const who = ctx.customerName ? `${ctx.customerName}'s ` : "";
  if (w.amountCents > 0) return w.kind === "referral" ? `Referral: ${who}${ord} (${ctx.percent}%)` : `Referred customer reward: ${ord} (${ctx.percent}%)`;
  const short = w.shortfallCents > 0 ? `. ${fmtMoney(w.shortfallCents)} could not be taken back (balance can't go below $0)` : "";
  return `${w.kind === "referral" ? "Referral" : "Referred customer reward"} reversed: ${ord} ${ctx.why}${short}`;
}

/**
 * Bring an order's store credit history in line with the order. Call inside the transaction that changes it.
 * `gone`: the order is being deleted, so everything it did is given back.
 * `why`: what happened, for the history ("canceled", "deleted", "changed").
 */
export async function syncOrderCredit(tx: Tx, orderId: string, opts: { by: string; why?: string; gone?: boolean }) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { lines: true } });
  const live = !!order && !opts.gone;
  const counts = live && countsInMoney(order!.status as OrderStatus);
  const referrals = await referralSettings(tx);
  let isFirstOrder = true;
  let referrerExists = false;
  if (counts && order!.referredById) {
    referrerExists = !!(await tx.customer.findUnique({ where: { id: order!.referredById }, select: { id: true } }));
    if (order!.customerId) {
      const earlier = await tx.order.count({
        where: { customerId: order!.customerId, id: { not: orderId }, status: { notIn: ["awaiting_payment", "canceled"] }, date: { lt: order!.date } },
      });
      isFirstOrder = earlier === 0;
    }
  }
  const targets = creditTargets(live ? { ...order!, owner: order!.owner as "A" | "B" | null, discountType: order!.discountType as "$" | "%" } : null, { counts, referrals, isFirstOrder, referrerExists });
  const existing = await tx.creditEntry.findMany({ where: { orderId } });
  const ids = [...new Set([...targets.map((t) => t.customerId), ...existing.map((e) => e.customerId)])];
  const bal = new Map<string, number>();
  for (const id of ids) bal.set(id, await creditBalance(tx, id));
  const plan = planCreditSync(targets, existing, (id) => bal.get(id) ?? 0);
  if (plan.short) {
    const c = await tx.customer.findUnique({ where: { id: plan.short.customerId }, select: { name: true } });
    throw new HttpError(
      409,
      `${c?.name ?? "This customer"} has ${fmtMoney(plan.short.haveCents)} store credit, but this order uses ${fmtMoney(plan.short.needCents)}. Lower the store credit on the order, or add credit on the customer first.`,
    );
  }
  if (plan.writes.length === 0) return;
  const customer = order?.customerId ? await tx.customer.findUnique({ where: { id: order.customerId }, select: { name: true } }) : null;
  const number = order?.number ?? existing.find((e) => e.orderNumber)?.orderNumber ?? null;
  const why = opts.why ?? (opts.gone ? "deleted" : order && !countsInMoney(order.status as OrderStatus) ? "canceled" : "changed");
  const now = new Date();
  for (const w of plan.writes) {
    await tx.creditEntry.create({
      data: {
        id: randomUUID(),
        customerId: w.customerId,
        date: now,
        amountCents: w.amountCents,
        kind: w.kind,
        reason: reasonFor(w, { number, why, customerName: customer?.name ?? "", percent: w.kind === "referral" ? referrals.percent : referrals.newCustomerPercent }),
        orderId,
        orderNumber: number,
        by: opts.by,
        shortfallCents: w.shortfallCents,
      },
    });
  }
}

/** Add (positive) or remove (negative) credit by hand. A reason is required; the balance never goes below $0. */
export async function adjustCredit(input: { customerId: string; amountCents: number; reason: string; by: string }) {
  const reason = input.reason.trim();
  if (!reason) throw new HttpError(400, "Write a reason, for example Giveaway, Apology or Correction.");
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) throw new HttpError(400, "Enter an amount.");
  return prisma.$transaction(async (tx) => {
    const c = await tx.customer.findUnique({ where: { id: input.customerId }, select: { name: true } });
    if (!c) throw new HttpError(404, "Customer not found. Reload the page.");
    const balance = await creditBalance(tx, input.customerId);
    if (input.amountCents < 0 && balance + input.amountCents < 0) {
      throw new HttpError(409, `${c.name} has ${fmtMoney(Math.max(0, balance))} store credit, so ${fmtMoney(-input.amountCents)} can't be removed.`);
    }
    await tx.creditEntry.create({ data: { id: randomUUID(), customerId: input.customerId, amountCents: input.amountCents, kind: "manual", reason, by: input.by.trim() } });
    return { balanceCents: balance + input.amountCents };
  });
}

/** Check a referrer pick: must exist and must not be the customer themselves. Returns the id or null. */
export async function checkReferrer(db: Db, referredById: string | null | undefined, customerId: string | null | undefined): Promise<string | null> {
  if (!referredById) return null;
  if (customerId && referredById === customerId) throw new HttpError(400, "A customer can't refer themselves. Pick someone else as Referred by.");
  const r = await db.customer.findUnique({ where: { id: referredById }, select: { id: true } });
  if (!r) throw new HttpError(400, "The customer picked as Referred by was not found. Pick them again.");
  return r.id;
}

/** First referrer wins: a customer who has none yet gets this one. */
export async function rememberReferrer(db: Db, customerId: string | null | undefined, referredById: string | null | undefined) {
  if (!customerId || !referredById || customerId === referredById) return;
  await db.customer.updateMany({ where: { id: customerId, referredById: null }, data: { referredById } });
}
