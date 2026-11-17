import { ImageResponse } from "next/og";
import { DEFAULT_ACCENT, TAGLINE } from "@/lib/store/config";
import { storeSnapshot } from "@/lib/store/server";

export const dynamic = "force-dynamic";

/** Default link preview image (used until one is uploaded in Content): the wordmark on white with a red rule. */
export async function GET() {
  const { data } = await storeSnapshot();
  const accent = /^#[0-9a-fA-F]{6}$/.test(data.store.accentColor) ? data.store.accentColor : DEFAULT_ACCENT;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#ffffff", padding: 72 }}>
        <div style={{ display: "flex", width: 96, height: 10, background: accent }} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 800, letterSpacing: 10, color: "#1c1817", textTransform: "uppercase" }}>{data.store.storeName}</div>
          <div style={{ display: "flex", marginTop: 20, fontSize: 34, color: "#5d5553", maxWidth: 900 }}>{TAGLINE}</div>
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#8a817e" }}>For laboratory research use only.</div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
