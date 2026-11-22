import { route } from "@/lib/api";
import { combinedPackingSlips } from "@/lib/bulk-ship";

/** GET ?ids=a,b,c -> one PDF with a packing slip per order, in that order (admin only). */
export const GET = route(async (req) => {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean);
  const pdf = await combinedPackingSlips(ids);
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="packing-slips-${ids.length}.pdf"`, "Cache-Control": "private, no-store" },
  });
});
