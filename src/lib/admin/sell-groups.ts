// The Sell screen list: sizes grouped under their product, in the same order as the store
// (products by their Inventory order, sizes by their size order). Pure.
import { listingVariants } from "../store/catalog";
import type { AppData, ProductRec } from "../types";

export interface SellGroup {
  key: string;
  name: string;
  /** Upload id of the first product photo, or null (the card then shows a colored tile). */
  photoId: string | null;
  color: string;
  variants: ProductRec[];
}

export function sellGroups(data: Pick<AppData, "products" | "listings">): SellGroup[] {
  const out: SellGroup[] = [];
  const placed = new Set<string>();
  for (const l of [...data.listings].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))) {
    const variants = listingVariants(data, l.id);
    if (variants.length === 0) continue;
    for (const v of variants) placed.add(v.id);
    out.push({ key: l.id, name: l.name, photoId: l.photos[0]?.id ?? null, color: variants[0].color, variants });
  }
  // Sizes without a parent product yet (the app creates one at startup) still show, each on its own.
  for (const p of data.products) {
    if (p.archived || placed.has(p.id)) continue;
    out.push({ key: p.id, name: p.name, photoId: null, color: p.color, variants: [p] });
  }
  return out;
}

/** What a size is called inside its product card: the size label, or the full name when it has none. */
export function sellVariantLabel(group: SellGroup, v: ProductRec): string {
  if (v.variantLabel.trim()) return v.variantLabel.trim();
  return group.variants.length > 1 ? v.name : "";
}
