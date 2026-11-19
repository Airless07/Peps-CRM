// One-time data fixes that run when the server starts, after the SQL migrations (src/instrumentation.ts).
// Each one writes a DataMigration row in the same transaction, so it runs exactly once: a value the
// owner changes afterwards (for example a size cleared on purpose) is never written back.
import { prisma } from "./db";
import { sizeInName } from "./store/product-info";

export const SIZE_BACKFILL_ID = "sizes-from-names";

export interface SizeFill {
  productId: string;
  /** The variant's name on the Sell screen, e.g. "GHK-Cu 100mg". */
  product: string;
  size: string;
}

/**
 * Sizes to fill in: every variant with an EMPTY size gets the size written in its own name, or else in
 * its parent product's name ("GHK-Cu 100mg" gives "100mg"). No size in either name = left blank.
 * A size another variant of the same product already uses is skipped (sizes must stay different).
 */
export function planSizeBackfill(
  products: { id: string; name: string; variantLabel: string; listingId: string | null }[],
  listings: { id: string; name: string }[],
): SizeFill[] {
  const listingName = new Map(listings.map((l) => [l.id, l.name]));
  const taken = new Map<string, Set<string>>();
  for (const p of products) {
    if (!p.listingId || !p.variantLabel.trim()) continue;
    taken.set(p.listingId, (taken.get(p.listingId) ?? new Set()).add(p.variantLabel.trim().toLowerCase()));
  }
  const out: SizeFill[] = [];
  for (const p of products) {
    if (p.variantLabel.trim()) continue;
    const size = sizeInName(p.name) || sizeInName((p.listingId && listingName.get(p.listingId)) || "");
    if (!size) continue;
    const used = p.listingId ? (taken.get(p.listingId) ?? new Set<string>()) : new Set<string>();
    if (used.has(size.toLowerCase())) continue;
    used.add(size.toLowerCase());
    if (p.listingId) taken.set(p.listingId, used);
    out.push({ productId: p.id, product: p.name, size });
  }
  return out;
}

/** Fills empty sizes from product names, once. Returns what it filled (null when it already ran). */
export async function backfillSizes(): Promise<SizeFill[] | null> {
  return prisma.$transaction(async (tx) => {
    if (await tx.dataMigration.findUnique({ where: { id: SIZE_BACKFILL_ID } })) return null;
    const [products, listings] = await Promise.all([
      tx.product.findMany({ select: { id: true, name: true, variantLabel: true, listingId: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
      tx.listing.findMany({ select: { id: true, name: true } }),
    ]);
    const plan = planSizeBackfill(products, listings);
    // Only ever writes into a size that is still empty.
    for (const f of plan) await tx.product.updateMany({ where: { id: f.productId, variantLabel: "" }, data: { variantLabel: f.size } });
    await tx.dataMigration.create({ data: { id: SIZE_BACKFILL_ID, detail: JSON.stringify(plan) } });
    return plan;
  });
}

export async function runDataMigrations() {
  try {
    const filled = await backfillSizes();
    if (filled) console.log(`[data] Sizes filled in from product names (${filled.length}):${filled.map((f) => `\n  ${f.product} -> ${f.size}`).join("")}`);
  } catch (e) {
    console.error("[data] size backfill failed:", e instanceof Error ? e.message : e);
  }
}
