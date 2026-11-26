import { body, route, type Ctx } from "@/lib/api";
import { deleteRestock, updateRestock } from "@/lib/restock-ops";
import { restockInput } from "@/lib/schemas";

/** Edit a saved restock order: stock, cost and money adjust by the difference. */
export const PATCH = route(async (req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  return { ok: true, restock: await updateRestock(id, await body(req, restockInput)) };
});

/** Delete a restock order: reverses its stock, cost and money. Logged. */
export const DELETE = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  await deleteRestock(id);
  return { ok: true };
});
