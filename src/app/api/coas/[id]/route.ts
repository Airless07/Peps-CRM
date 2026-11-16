import { body, route, type Ctx } from "@/lib/api";
import { prisma } from "@/lib/db";
import { coaUpdate } from "@/lib/store/schemas";
import { removeUpload } from "@/lib/uploads";

export const PATCH = route(async (req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const data = await body(req, coaUpdate);
  await prisma.$transaction(async (tx) => {
    const coa = await tx.coa.findUniqueOrThrow({ where: { id } });
    // Only one COA per size can be the current one.
    if (data.isCurrent) await tx.coa.updateMany({ where: { productId: coa.productId }, data: { isCurrent: false } });
    await tx.coa.update({ where: { id }, data });
  });
  return { ok: true };
});

export const DELETE = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const coa = await prisma.coa.delete({ where: { id } });
  await removeUpload(coa.file);
  return { ok: true };
});
