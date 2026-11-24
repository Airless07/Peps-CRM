import { NextResponse } from "next/server";
import { HttpError, route, type Ctx } from "@/lib/api";
import { readUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** Any review photo (waiting, approved or rejected). Admin only. */
export const GET = route(async (_req, ctx: Ctx<{ name: string }>) => {
  const { name } = await ctx.params;
  if (!/^[a-f0-9]{16}-(480|1600)\.webp$/.test(name)) throw new HttpError(404, "Photo not found.");
  const f = await readUpload(name, "private");
  if (!f) throw new HttpError(404, "Photo not found.");
  return new NextResponse(new Uint8Array(f.body), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store" } });
});
