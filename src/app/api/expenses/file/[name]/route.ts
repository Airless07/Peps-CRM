import { NextResponse } from "next/server";
import { HttpError, route, type Ctx } from "@/lib/api";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** An expense attachment. Private: only a signed-in admin, and only a file saved on an expense. */
export const GET = route(async (_req, ctx: Ctx<{ name: string }>) => {
  const { name } = await ctx.params;
  const x = await prisma.expense.findFirst({ where: { file: name }, select: { fileName: true } });
  const f = x ? await readUpload(name, "private") : null;
  if (!f) throw new HttpError(404, "That attachment is gone.");
  const safe = (x?.fileName || name).replace(/[^\w. -]/g, "_");
  return new NextResponse(new Uint8Array(f.body), { headers: { "Content-Type": f.mime, "Content-Disposition": `inline; filename="${safe}"`, "Cache-Control": "private, no-store" } });
});
