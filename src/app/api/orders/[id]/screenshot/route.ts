import { NextResponse } from "next/server";
import { HttpError, route, type Ctx } from "@/lib/api";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** The customer's payment screenshot. Private: only a signed-in admin can open it. */
export const GET = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const o = await prisma.order.findUnique({ where: { id }, select: { screenshotFile: true } });
  const f = o?.screenshotFile ? await readUpload(o.screenshotFile, "private") : null;
  if (!f) throw new HttpError(404, "This order has no payment screenshot.");
  return new NextResponse(new Uint8Array(f.body), { headers: { "Content-Type": f.mime, "Cache-Control": "private, no-store" } });
});
