import { HttpError, route, type Ctx } from "@/lib/api";
import { prisma } from "@/lib/db";

/** Undo a split (and its auto payouts). Only the most recent split can be undone. */
export const DELETE = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const latest = await prisma.split.findFirst({ orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
  if (!latest || latest.id !== id) throw new HttpError(400, "Only the most recent split can be undone");
  await prisma.split.delete({ where: { id } });
  return { ok: true };
});
