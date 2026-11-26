import { body, route } from "@/lib/api";
import { createRestock } from "@/lib/restock-ops";
import { restockCreate } from "@/lib/schemas";

/** Save a restock order (after the review screen). Stock up, cost per vial updated, business money down. */
export const POST = route(async (req) => {
  const { id, ...input } = await body(req, restockCreate);
  return { ok: true, restock: await createRestock(id, input) };
});
