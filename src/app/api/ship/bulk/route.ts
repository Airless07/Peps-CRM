import { z } from "zod";
import { body, route } from "@/lib/api";
import { buyBulkLabels, quoteBulkLabels, shipBulk } from "@/lib/bulk-ship";
import { requestOrigin } from "@/lib/order-ops";

const input = z.object({ action: z.enum(["quote", "buy", "ship"]), ids: z.array(z.string().min(1).max(64)).min(1, "Pick at least one order").max(200) });

/** Ship queue bulk actions (admin only, see middleware). Each order goes through the single-order code. */
export const POST = route(async (req) => {
  const { action, ids } = await body(req, input);
  const origin = requestOrigin(req);
  if (action === "quote") return quoteBulkLabels(ids);
  if (action === "buy") return { results: await buyBulkLabels(ids, origin) };
  return { results: await shipBulk(ids, origin) };
});
