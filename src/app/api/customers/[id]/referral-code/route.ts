import { z } from "zod";
import { body, route, type Ctx } from "@/lib/api";
import { prisma } from "@/lib/db";
import { changeReferralCode, codeAvailability } from "@/lib/referral-codes";

const input = z.object({ code: z.string().max(40), by: z.string().max(40).default("Admin"), check: z.boolean().default(false) });

/** Admin: check or change a customer's referral code. Same rules as the customer's own page. */
export const POST = route(async (req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const { code, by, check } = await body(req, input);
  if (check) {
    const message = await codeAvailability(prisma, code, id);
    return { ok: !message, message };
  }
  const r = await changeReferralCode(id, code, by || "Admin");
  return { ok: true, code: r.display };
});
