import { body, route } from "@/lib/api";
import { requestOrigin } from "@/lib/order-ops";
import { savedOrderInput } from "@/lib/schemas";
import { saveOrderForLater } from "@/lib/sell-ops";

/** Save the Sell cart for later (or update a saved order). Holds its items out of stock; no money effect. */
export const POST = route(async (req) => {
  await saveOrderForLater(await body(req, savedOrderInput), requestOrigin(req));
  return { ok: true };
});
