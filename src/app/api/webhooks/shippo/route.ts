import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { applyTrack, requestOrigin } from "@/lib/order-ops";
import { readTrack, webhookSecret } from "@/lib/shippo";

/**
 * Shippo tracking webhook ("track_updated"). Marks orders Shipped / Delivered automatically.
 * Set it up in Shippo: API -> Webhooks -> URL https://<your site>/api/webhooks/shippo?key=<secret>.
 * The secret is shown in Settings -> Shipping. Without the right key the call is ignored.
 */
export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const want = webhookSecret();
  if (key.length !== want.length || !timingSafeEqual(Buffer.from(key), Buffer.from(want))) {
    return NextResponse.json({ error: "Wrong key" }, { status: 401 });
  }
  let payload: { event?: string; data?: { tracking_number?: string } & Parameters<typeof readTrack>[0] };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const number = String(payload?.data?.tracking_number ?? "").trim();
  if (payload?.event !== "track_updated" || !number) return NextResponse.json({ ok: true, ignored: true });
  const order = await prisma.order.findFirst({ where: { trackingNumber: number, source: "online" }, select: { id: true } });
  if (!order) return NextResponse.json({ ok: true, ignored: true });
  try {
    const r = await applyTrack(order.id, readTrack(payload.data!), requestOrigin(req));
    return NextResponse.json({ ok: true, changed: r.changed });
  } catch (e) {
    console.error("shippo webhook", e);
    return NextResponse.json({ ok: true });
  }
}
