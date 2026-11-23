import { cookies } from "next/headers";
import { z } from "zod";
import { body, route } from "@/lib/api";
import { CLIENT_METRICS, isBot, PRODUCT_METRICS, track, type Metric } from "@/lib/analytics";
import { allow, clientIp } from "@/lib/ratelimit";
import { SESSION_COOKIE } from "@/lib/session";
import { isAdminToken } from "@/lib/admin-auth";
import { storeSnapshot } from "@/lib/store/server";

const input = z.object({
  e: z.enum(CLIENT_METRICS as [Metric, ...Metric[]]),
  /** Product (listing) id, for product views and add-to-carts. */
  id: z.string().max(80).optional(),
});

/**
 * Built-in analytics. Adds one to today's counter for an event. Nothing about the visitor is
 * stored: the IP address is only used in memory to stop one client from inflating the numbers.
 * Always answers 204, counted or not, so the response says nothing about what was accepted.
 */
export const POST = route(
  async (req) => {
    const done = new Response(null, { status: 204 });
    const { e, id } = await body(req, input);
    if (isBot(req.headers.get("user-agent"))) return done;
    if (!allow(`track:${clientIp(req)}`, 60, 60_000)) return done;
    const { data, catalog } = await storeSnapshot();
    // A closed store has no visitors, and the owner previewing or working in the admin is not a visitor.
    if (!data.store.open) return done;
    if (await isAdminToken((await cookies()).get(SESSION_COOKIE)?.value)) return done;
    let key = "";
    if (PRODUCT_METRICS.includes(e)) {
      // Only real products on the website are counted, so the table cannot be filled with junk keys.
      if (!id || !catalog.products.some((p) => p.id === id)) return done;
      key = id;
    }
    await track(e, key);
    return done;
  },
  { public: true },
);
