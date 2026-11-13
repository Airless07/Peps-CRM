import { body, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { orderInput } from "@/lib/schemas";

export const POST = route(async (req) => {
  const { lines, ...order } = await body(req, orderInput);
  await prisma.order.create({
    data: { ...order, lines: { create: lines.map((l, i) => ({ ...l, sortOrder: i })) } },
  });
  return { ok: true };
});
