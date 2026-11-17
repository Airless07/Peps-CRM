import { body, route } from "@/lib/api";
import { savedOrderInput } from "@/lib/schemas";
import { saveOrderForLater } from "@/lib/sell-ops";

/** Save the Sell cart for later (or update a saved order). No stock or money effect. */
export const POST = route(async (req) => {
  await saveOrderForLater(await body(req, savedOrderInput));
  return { ok: true };
});
