import { z } from "zod";
import { body, route } from "@/lib/api";
import { prisma } from "@/lib/db";

export const POST = route(async (req) => {
  const { ids } = await body(req, z.object({ ids: z.array(z.string()).max(1000) }));
  await prisma.$transaction(ids.map((id, i) => prisma.product.update({ where: { id }, data: { sortOrder: i } })));
  return { ok: true };
});
