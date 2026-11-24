import { body, route, type Ctx } from "@/lib/api";
import { prisma } from "@/lib/db";
import { deleteReview } from "@/lib/reviews/ops";
import { reviewUpdate } from "@/lib/store/schemas";

/** Approve, hide or edit a review. Changing the words marks it "Edited by store". Reviews can't be created here. */
export const PATCH = route(async (req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const data = await body(req, reviewUpdate);
  const cur = await prisma.review.findUniqueOrThrow({ where: { id } });
  const edited = cur.edited || (data.text !== undefined && data.text !== cur.text) || (data.title !== undefined && data.title !== cur.title);
  await prisma.review.update({ where: { id }, data: { ...data, edited } });
  return { ok: true };
});

/** Delete a review and its photo files for good. */
export const DELETE = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  await deleteReview(id);
  return { ok: true };
});
