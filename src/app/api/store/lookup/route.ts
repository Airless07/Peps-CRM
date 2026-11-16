import { body, HttpError, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { lookupInput } from "@/lib/store/schemas";

/** Order number + email -> the secret status link. Rate limited so order numbers can't be guessed in bulk. */
export const POST = route(
  async (req) => {
    rateLimit(req, "lookup", 10, 10 * 60_000);
    const { number, email } = await body(req, lookupInput);
    const o = await prisma.order.findUnique({ where: { number }, select: { token: true, email: true, source: true } });
    if (!o || o.source !== "online" || !o.token || o.email.toLowerCase() !== email) {
      throw new HttpError(404, "We couldn't find an order with that number and email. Check both and try again.");
    }
    return { token: o.token };
  },
  { public: true },
);
