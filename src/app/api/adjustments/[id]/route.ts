import { body, route, type Ctx } from "@/lib/api";
import { prisma } from "@/lib/db";
import { updateAdjustment } from "@/lib/lab-testing";
import { adjustmentUpdate } from "@/lib/schemas";

export const PATCH = route(async (req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  return updateAdjustment(id, await body(req, adjustmentUpdate));
});

export const DELETE = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  await prisma.stockAdjustment.delete({ where: { id } });
  return { ok: true };
});
