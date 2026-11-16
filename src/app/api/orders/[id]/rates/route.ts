import { route, type Ctx } from "@/lib/api";
import { labelRates } from "@/lib/order-ops";

export const dynamic = "force-dynamic";

/** Live label prices for this order's address. Nothing is bought here. */
export const GET = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  return labelRates(id);
});
