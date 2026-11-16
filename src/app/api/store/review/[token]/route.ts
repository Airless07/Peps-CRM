import { randomUUID } from "node:crypto";
import { body, HttpError, route, type Ctx } from "@/lib/api";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { reviewInput } from "@/lib/store/schemas";

/** Leave a store-experience review through the secret link from the delivered email. One per order. */
export const POST = route(
  async (req, ctx: Ctx<{ token: string }>) => {
    rateLimit(req, "review", 6, 30 * 60_000);
    const { token } = await ctx.params;
    const input = await body(req, reviewInput);
    const order = await prisma.order.findUnique({ where: { reviewToken: token }, include: { review: true } });
    if (!order || order.status !== "delivered") throw new HttpError(404, "This review link is not valid.");
    if (order.review) throw new HttpError(409, "A review was already left for this order. Thank you.");
    await prisma.review.create({ data: { id: randomUUID(), orderId: order.id, ...input, status: "pending" } });
    return { ok: true };
  },
  { public: true },
);
