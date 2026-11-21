// Customer database operations. None of these touch money: orders are only re-linked.
// Everything returned to the admin goes through toCustomer(), which never includes a password hash or token.
import type { Prisma } from "@prisma/client";
import { HttpError } from "./api";
import { checkReferrer } from "./credit-ops";
import { mergedFields } from "./customers";
import { prisma } from "./db";
import { uniqueReferralCode } from "./referral-codes";
import { toCustomer } from "./serialize";
import type { CustomerRec } from "./types";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/**
 * Make sure the order's customer exists. A new id (from "+ Add new customer" in the cart)
 * is created with the typed name. Returns the name snapshot to store on the order.
 */
export async function ensureOrderCustomer(tx: Tx, customerId: string | null, name: string): Promise<string> {
  if (!customerId) return name.trim();
  const existing = await tx.customer.findUnique({ where: { id: customerId } });
  if (existing) return existing.name;
  const clean = name.trim();
  if (!clean) throw new HttpError(400, "A new customer needs a name");
  await tx.customer.create({ data: { id: customerId, name: clean, referralCode: await uniqueReferralCode(tx, clean) } });
  return clean;
}

/** Emails are unique (any case). Throws when another customer already uses this one. */
export async function assertEmailFree(db: Db, email: string, exceptId?: string) {
  const e = email.trim().toLowerCase();
  if (!e) return;
  const rows = await db.customer.findMany({ where: { email: { not: "" }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true, email: true } });
  const other = rows.find((c) => c.email.trim().toLowerCase() === e);
  if (other) throw new HttpError(409, `${other.name} already uses ${e}. Each customer needs their own email. Merge the two customers if they are the same person.`);
}

/**
 * New customer from the admin. With an email it is also a store account with no password yet
 * ("Invited"): send them the invite link so they choose one.
 */
export async function createCustomer(input: { id: string; name: string; phone: string; email: string; notes: string; referredById: string | null }): Promise<CustomerRec> {
  return prisma.$transaction(async (tx) => {
    const email = input.email.trim().toLowerCase();
    await assertEmailFree(tx, email);
    const referredById = await checkReferrer(tx, input.referredById, input.id);
    const c = await tx.customer.create({ data: { ...input, email, referredById, referralCode: await uniqueReferralCode(tx, input.name) } });
    return toCustomer(c);
  });
}

export async function updateCustomer(id: string, patch: { name?: string; phone?: string; email?: string; notes?: string; referredById?: string | null }): Promise<CustomerRec> {
  return prisma.$transaction(async (tx) => {
    const data = { ...patch };
    if (data.email !== undefined) {
      data.email = data.email.trim().toLowerCase();
      await assertEmailFree(tx, data.email, id);
      const cur = await tx.customer.findUnique({ where: { id }, select: { passwordHash: true, email: true } });
      // An account signs in with its email, so it can't be removed (change it instead).
      if (cur?.passwordHash && !data.email) throw new HttpError(400, "This customer has a website account and signs in with their email, so it can't be empty. Change it instead.");
    }
    if (data.referredById !== undefined) data.referredById = await checkReferrer(tx, data.referredById, id);
    const before = await tx.customer.findUnique({ where: { id }, select: { email: true } });
    const c = await tx.customer.update({
      where: { id },
      // A new email makes any invite link sent to the old one stop working.
      data: { ...data, ...(data.email !== undefined && before && before.email.toLowerCase() !== data.email ? { inviteTokenHash: null, inviteExpiresAt: null } : {}) },
    });
    if (patch.name !== undefined) {
      await tx.order.updateMany({ where: { customerId: id }, data: { customer: c.name } });
      await tx.savedOrder.updateMany({ where: { customerId: id }, data: { customer: c.name } });
    }
    return toCustomer(c);
  });
}

/** Move every order of `fromId` to `intoId`, then delete `fromId`. Store credit and referrals move too. */
export async function mergeCustomers(fromId: string, intoId: string) {
  if (fromId === intoId) throw new HttpError(400, "Pick two different customers");
  return prisma.$transaction(async (tx) => {
    const [from, into] = await Promise.all([
      tx.customer.findUnique({ where: { id: fromId } }),
      tx.customer.findUnique({ where: { id: intoId } }),
    ]);
    if (!from || !into) throw new HttpError(404, "Customer not found");
    const moved = await tx.order.updateMany({ where: { customerId: fromId }, data: { customerId: intoId, customer: into.name } });
    await tx.savedOrder.updateMany({ where: { customerId: fromId }, data: { customerId: intoId, customer: into.name } });
    // Store credit history follows the person, so the balance is kept.
    await tx.creditEntry.updateMany({ where: { customerId: fromId }, data: { customerId: intoId } });
    // People and orders the duplicate referred now point at the kept customer.
    await tx.customer.updateMany({ where: { referredById: fromId }, data: { referredById: intoId } });
    await tx.order.updateMany({ where: { referredById: fromId }, data: { referredById: intoId } });
    await tx.savedOrder.updateMany({ where: { referredById: fromId }, data: { referredById: intoId } });
    await tx.customer.update({
      where: { id: intoId },
      data: { ...mergedFields(into, from), email: into.email || from.email, referredById: into.referredById ?? (from.referredById !== intoId ? from.referredById : null) },
    });
    // Nobody refers themselves after a merge.
    await tx.customer.updateMany({ where: { id: intoId, referredById: intoId }, data: { referredById: null } });
    await tx.order.updateMany({ where: { customerId: intoId, referredById: intoId }, data: { referredById: null } });
    await tx.customer.delete({ where: { id: fromId } });
    return { ok: true, movedOrders: moved.count };
  });
}

/** Delete a customer. Their orders are unlinked (they keep the name snapshot), never deleted. Their store credit goes with them. */
export async function deleteCustomer(id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.order.updateMany({ where: { customerId: id }, data: { customerId: null } });
    // Saved orders keep the typed name, like orders do. A held credit can't be used without the customer.
    await tx.savedOrder.updateMany({ where: { customerId: id }, data: { customerId: null, storeCreditCents: 0 } });
    await tx.customer.updateMany({ where: { referredById: id }, data: { referredById: null } });
    await tx.order.updateMany({ where: { referredById: id }, data: { referredById: null } });
    await tx.savedOrder.updateMany({ where: { referredById: id }, data: { referredById: null } });
    await tx.customer.delete({ where: { id } });
    return { ok: true };
  });
}
