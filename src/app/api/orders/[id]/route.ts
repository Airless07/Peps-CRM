import { body, HttpError, route, type Ctx } from "@/lib/api";
import { ensureOrderCustomer } from "@/lib/customer-ops";
import { prisma } from "@/lib/db";
import { orderInput } from "@/lib/schemas";
import { cleanSale } from "@/lib/sell-ops";

/** Replace the whole order (fields + lines). Line ids are kept so links stay intact. */
export const PUT = route(async (req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const { lines, id: bodyId, ...order } = cleanSale(await body(req, orderInput));
  if (bodyId !== id) throw new HttpError(400, "Order id mismatch");
  await prisma.$transaction(async (tx) => {
    const customer = await ensureOrderCustomer(tx, order.customerId, order.customer);
    await tx.order.update({ where: { id }, data: { ...order, customer } });
    await tx.orderLine.deleteMany({ where: { orderId: id, id: { notIn: lines.map((l) => l.id) } } });
    for (const [i, l] of lines.entries()) {
      const data = { ...l, orderId: id, sortOrder: i };
      await tx.orderLine.upsert({ where: { id: l.id }, update: data, create: data });
    }
  });
  return { ok: true };
});

export const DELETE = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const o = await prisma.order.findUnique({ where: { id }, select: { source: true } });
  if (o?.source === "online") throw new HttpError(400, "Website orders are never deleted. Cancel or archive the order instead.");
  await prisma.$transaction([prisma.promotionUse.deleteMany({ where: { orderId: id } }), prisma.order.delete({ where: { id } })]);
  return { ok: true };
});
