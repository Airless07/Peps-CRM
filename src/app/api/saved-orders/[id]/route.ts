import { route, type Ctx } from "@/lib/api";
import { deleteSavedOrder } from "@/lib/sell-ops";

/** Delete a saved order. It never counted in stock or money, so nothing else changes. */
export const DELETE = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  await deleteSavedOrder(id);
  return { ok: true };
});
