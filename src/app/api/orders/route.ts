import { body, route } from "@/lib/api";
import { ensureOrderCustomer } from "@/lib/customer-ops";
import { prisma } from "@/lib/db";
import { orderInput } from "@/lib/schemas";

export const POST = route(async (req) => {
  const { lines, ...order } = await body(req, orderInput);
  await prisma.$transaction(async (tx) => {
    const customer = await ensureOrderCustomer(tx, order.customerId, order.customer);
    await tx.order.create({
      data: { ...order, customer, lines: { create: lines.map((l, i) => ({ ...l, sortOrder: i })) } },
    });
  });
  return { ok: true };
});
