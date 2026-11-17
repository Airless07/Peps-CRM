// Customer database operations. None of these touch money: orders are only re-linked.
import type { Prisma } from "@prisma/client";
import { HttpError } from "./api";
import { mergedFields } from "./customers";
import { prisma } from "./db";

type Tx = Prisma.TransactionClient;

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
  await tx.customer.create({ data: { id: customerId, name: clean } });
  return clean;
}

export async function updateCustomer(id: string, patch: { name?: string; phone?: string; notes?: string }) {
  return prisma.$transaction(async (tx) => {
    const c = await tx.customer.update({ where: { id }, data: patch });
    if (patch.name !== undefined) {
      await tx.order.updateMany({ where: { customerId: id }, data: { customer: c.name } });
      await tx.savedOrder.updateMany({ where: { customerId: id }, data: { customer: c.name } });
    }
    return c;
  });
}

/** Move every order of `fromId` to `intoId`, then delete `fromId`. */
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
    await tx.customer.update({ where: { id: intoId }, data: mergedFields(into, from) });
    await tx.customer.delete({ where: { id: fromId } });
    return { ok: true, movedOrders: moved.count };
  });
}

/** Delete a customer. Their orders are unlinked (they keep the name snapshot), never deleted. */
export async function deleteCustomer(id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.order.updateMany({ where: { customerId: id }, data: { customerId: null } });
    // Saved orders keep the typed name, like orders do.
    await tx.savedOrder.updateMany({ where: { customerId: id }, data: { customerId: null } });
    await tx.customer.delete({ where: { id } });
    return { ok: true };
  });
}
