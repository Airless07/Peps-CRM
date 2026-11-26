import { body, route, type Ctx } from "@/lib/api";
import { deleteExpense, updateExpense } from "@/lib/expense-ops";
import { expenseInput } from "@/lib/schemas";

export const PATCH = route(async (req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const { expense, changed } = await updateExpense(id, await body(req, expenseInput));
  return { ok: true, expense, changed };
});

export const DELETE = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  await deleteExpense(id);
  return { ok: true };
});
