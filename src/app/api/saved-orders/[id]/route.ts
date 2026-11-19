import { route, type Ctx } from "@/lib/api";
import { deleteSavedOrder } from "@/lib/sell-ops";

/** Delete a saved order. The stock it held goes back; it never counted in money. */
export const DELETE = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  await deleteSavedOrder(id);
  return { ok: true };
});
