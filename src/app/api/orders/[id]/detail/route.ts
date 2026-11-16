import { route, type Ctx } from "@/lib/api";
import { prisma } from "@/lib/db";
import { stockShortfalls } from "@/lib/order-ops";

export const dynamic = "force-dynamic";

/** Timeline (status changes, emails, notes) and stock warnings for one order. */
export const GET = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const [events, shortfalls] = await Promise.all([prisma.orderEvent.findMany({ where: { orderId: id }, orderBy: { at: "asc" } }), stockShortfalls(id)]);
  return { events: events.map((e) => ({ ...e, at: e.at.toISOString() })), shortfalls };
});
