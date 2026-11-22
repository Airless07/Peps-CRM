import { route, type Ctx } from "@/lib/api";
import { prisma } from "@/lib/db";

/** Admin: a customer's referral code change history (newest first). */
export const GET = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const rows = await prisma.referralCodeChange.findMany({ where: { customerId: id }, orderBy: { at: "desc" } });
  return { changes: rows.map((r) => ({ id: r.id, oldCode: r.oldCode, newCode: r.newCode, by: r.by, at: r.at.toISOString() })) };
});
