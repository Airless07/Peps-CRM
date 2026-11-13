import { body, route, type Ctx } from "@/lib/api";
import { deleteCustomer, updateCustomer } from "@/lib/customer-ops";
import { customerUpdate } from "@/lib/schemas";

export const PATCH = route(async (req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  return updateCustomer(id, await body(req, customerUpdate));
});

/** Unlinks the customer's orders; never deletes orders. */
export const DELETE = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  return deleteCustomer(id);
});
