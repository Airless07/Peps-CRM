import { body, route, type Ctx } from "@/lib/api";
import { prisma } from "@/lib/db";
import { productUpdate } from "@/lib/schemas";
import { removeUpload } from "@/lib/uploads";

export const PATCH = route(async (req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  return prisma.product.update({ where: { id }, data: await body(req, productUpdate) });
});

/** Delete a size. Its restocks, adjustments and COAs go with it; past sales are kept. An empty parent is removed too. */
export const DELETE = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const coas = await prisma.coa.findMany({ where: { productId: id }, select: { file: true } });
  const p = await prisma.product.delete({ where: { id } });
  for (const c of coas) await removeUpload(c.file);
  if (p.listingId && (await prisma.product.count({ where: { listingId: p.listingId } })) === 0) {
    await prisma.listing.delete({ where: { id: p.listingId } }).catch(() => {});
  }
  return { ok: true };
});
