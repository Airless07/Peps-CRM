import { body, route } from "@/lib/api";
import { requestOrigin } from "@/lib/order-ops";
import { saleInput } from "@/lib/schemas";
import { recordSale } from "@/lib/sell-ops";

/** Record an in-person sale (the Sell screen), from the cart or by completing a saved order. */
export const POST = route(async (req) => {
  const { fromSavedId, ...sale } = await body(req, saleInput);
  await recordSale(sale, requestOrigin(req), fromSavedId);
  return { ok: true };
});
