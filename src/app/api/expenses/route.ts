import { body, route } from "@/lib/api";
import { createExpense } from "@/lib/expense-ops";
import { expenseCreate } from "@/lib/schemas";

/** Add an expense. It lowers business money on its date and the cash of whoever paid. */
export const POST = route(async (req) => {
  const { id, ...input } = await body(req, expenseCreate);
  return { ok: true, expense: await createExpense(id, input) };
});
