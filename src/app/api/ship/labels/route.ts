import { route } from "@/lib/api";
import { combinedLabels } from "@/lib/bulk-ship";

/** GET ?ids=a,b,c -> one 4x6 PDF with every label, in that order (admin only). */
export const GET = route(async (req) => {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean);
  const { pdf, included, skipped } = await combinedLabels(ids);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="labels-${included.length}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Labels-Included": included.join(","),
      "X-Labels-Skipped": encodeURIComponent(JSON.stringify(skipped)),
    },
  });
});
