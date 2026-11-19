// Size labels next to product names, everywhere a product is listed. Pure: server and client.

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/**
 * "BPC-157" + "10mg" gives "BPC-157 10mg". A name that already says the size is left alone
 * ("GHK-Cu 100mg" + "100mg" stays "GHK-Cu 100mg"), so nothing is ever doubled.
 */
export function withSize(name: string, size?: string | null): string {
  const n = name.trim();
  const s = (size ?? "").trim();
  if (!s) return n;
  if (!n) return s;
  return squash(n).includes(squash(s)) ? n : `${n} ${s}`;
}

/** "10mg · 3ml": the size with the vial volume, when there is one. */
export const sizeWithVolume = (size: string, volume?: string | null) => [size.trim(), (volume ?? "").trim()].filter(Boolean).join(" · ");

/** The name of an order line with its product's size (lines carry `size` when loaded from the database). */
export const lineName = (l: { productName: string; size?: string }) => (l.productName ? withSize(l.productName, l.size) : "Deleted product");

/**
 * The next value for a "-" / "+" button: one step up or down, snapped to the step grid (so 0.1 + 0.2
 * never shows 0.30000000000000004, and 2.35 with step 0.5 goes to 2.5 / 2), kept within lo..hi.
 */
export function stepValue(base: number, dir: -1 | 1, step: number, lo = -Infinity, hi = Infinity): number {
  const dec = (String(step).split(".")[1] ?? "").length;
  const onGrid = Math.abs(base / step - Math.round(base / step)) < 1e-9;
  const k = onGrid ? Math.round(base / step) + dir : dir > 0 ? Math.floor(base / step) + 1 : Math.ceil(base / step) - 1;
  return Math.min(hi, Math.max(lo, Number((k * step).toFixed(dec))));
}
