// Carrier tracking links. Pure (safe for client components). Only carriers whose public tracking URL
// is known get a link; anything else returns null and the number is shown as plain text.
export function carrierFamily(carrier: string): "usps" | "ups" | "fedex" | "dhl" | "" {
  const t = String(carrier ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (t === "usps" || t.startsWith("unitedstatespostal")) return "usps";
  if (t === "ups" || t.startsWith("unitedparcel")) return "ups";
  if (t.startsWith("fedex") || t === "federalexpress") return "fedex";
  if (t.startsWith("dhl")) return "dhl";
  return "";
}

export function carrierDisplayName(carrier: string): string {
  return { usps: "USPS", ups: "UPS", fedex: "FedEx", dhl: "DHL", "": String(carrier ?? "").trim() }[carrierFamily(carrier)];
}

export function trackingUrl(carrier: string, trackingNumber: string): string | null {
  const n = encodeURIComponent(String(trackingNumber ?? "").trim());
  if (!n) return null;
  switch (carrierFamily(carrier)) {
    case "usps":
      return `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${n}`;
    case "ups":
      return `https://www.ups.com/track?loc=en_US&tracknum=${n}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    default:
      return null;
  }
}
