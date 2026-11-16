import { NextResponse, type NextRequest } from "next/server";
import { readUpload } from "@/lib/uploads";

/** Public uploads: product photos, hover animations, COAs, logo. File names are random and never change, so they cache forever. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const f = path.length === 1 ? await readUpload(path[0], "public") : null;
  if (!f) return new NextResponse("Not found", { status: 404 });
  const download = req.nextUrl.searchParams.get("download");
  return new NextResponse(new Uint8Array(f.body), {
    headers: {
      "Content-Type": f.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ...(download ? { "Content-Disposition": `attachment; filename="${download.replace(/[^\w.\- ]/g, "").slice(0, 80) || "file"}"` } : {}),
    },
  });
}
