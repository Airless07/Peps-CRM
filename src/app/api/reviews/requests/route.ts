import { z } from "zod";
import { body, route } from "@/lib/api";
import { requestOrigin } from "@/lib/order-ops";
import { pastCustomerPreview, sendPastCustomerRequests } from "@/lib/reviews/ops";

/** "Ask past customers for reviews": the orders that can still get a request (one per customer), and the rest with why not. */
export const GET = route(async () => await pastCustomerPreview());

const input = z.object({ orderIds: z.array(z.string().max(100)).min(1, "Pick at least one order").max(1000) });

/** Send one review request per picked order. Orders already asked or reviewed since the preview are skipped. */
export const POST = route(async (req) => {
  const { orderIds } = await body(req, input);
  const r = await sendPastCustomerRequests(orderIds, requestOrigin(req));
  return { ok: true, ...r, message: `${r.sent} review request${r.sent === 1 ? "" : "s"} sent${r.skipped ? `, ${r.skipped} skipped (already asked, reviewed or no longer eligible)` : ""}.` };
});
