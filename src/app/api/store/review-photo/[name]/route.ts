import { NextResponse } from "next/server";
import { readUpload } from "@/lib/uploads";
import { publicPhotoAllowed } from "@/lib/reviews/ops";

export const dynamic = "force-dynamic";

/**
 * A review photo, only once the owner approved it (and the review is live). Everything else is a 404,
 * so a photo waiting for approval, rejected, or on a hidden review can't be opened even with its address.
 * Short cache: hiding a review takes its photos off the site within a minute.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const m = /^([a-f0-9]{16})-(480|1600)\.webp$/.exec(name);
  if (!m || !(await publicPhotoAllowed(m[1]))) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const f = await readUpload(name, "private");
  if (!f) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new NextResponse(new Uint8Array(f.body), { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" } });
}
