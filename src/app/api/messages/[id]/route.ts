import { z } from "zod";
import { body, route, type Ctx } from "@/lib/api";
import { prisma } from "@/lib/db";

export const PATCH = route(async (req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  await prisma.contactMessage.update({ where: { id }, data: await body(req, z.object({ handled: z.boolean() })) });
  return { ok: true };
});

export const DELETE = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  await prisma.contactMessage.delete({ where: { id } });
  return { ok: true };
});
