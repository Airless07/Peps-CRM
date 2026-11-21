import { body, route, type Ctx } from "@/lib/api";
import { adjustCredit } from "@/lib/credit-ops";
import { creditAdjust } from "@/lib/schemas";

/** Add or remove store credit by hand, with a reason. The balance can't go below $0. */
export const POST = route(async (req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const input = await body(req, creditAdjust);
  return adjustCredit({ customerId: id, amountCents: input.amountCents, reason: input.reason, by: input.by || "Admin" });
});
