// One-time data fixes that run when the server starts, after the SQL migrations (src/instrumentation.ts).
// Each one writes a DataMigration row in the same transaction, so it runs exactly once: a value the
// owner changes afterwards (for example a size cleared on purpose) is never written back.
import { prisma } from "./db";
import { sizeInName } from "./store/product-info";
import { DEFAULT_CONTENT, POLICY_IDS, SUPPORT_EMAIL } from "./store/config";
import OLD_POLICIES from "./store/policies-before-2026-11.json";

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

// ---------------------------------------------------------------- Product names
export const NAMES_ID = "canonical-product-names-2026-11";
/** Old short names -> the names customers should see. Only the start of a name is changed (sizes stay). */
const NAME_RULES: [RegExp, string][] = [
  [/^Reta(?=\s|$)/, "Retatrutide"],
  [/^MOTS-C(?=\s|$)/i, "MOTS-c"],
  [/^5[ -]?Amino(?:[ -]?1MQ)?(?=\s|$)/i, "5-Amino-1MQ"],
  [/^CJC\s*\/\s*IPA(?=\s|$)/i, "CJC-1295 (NO DAC) + Ipamorelin"],
  [/^CJC-1295\s*\+\s*Ipamorelin(?=\s|$)/i, "CJC-1295 (NO DAC) + Ipamorelin"],
];
export function canonicalName(name: string): string {
  for (const [re, to] of NAME_RULES) if (re.test(name)) return name.replace(re, to);
  return name;
}

/**
 * Renames products and website listings to the canonical names, once. Slugs (URLs), past orders and
 * receipts are not touched. Every change is written to the DataMigration row so it can be undone.
 */
export async function canonicalProductNames(): Promise<{ table: string; id: string; from: string; to: string }[] | null> {
  return prisma.$transaction(async (tx) => {
    if (await tx.dataMigration.findUnique({ where: { id: NAMES_ID } })) return null;
    const changes: { table: string; id: string; from: string; to: string }[] = [];
    for (const l of await tx.listing.findMany({ select: { id: true, name: true } })) {
      const to = canonicalName(l.name);
      if (to !== l.name) {
        await tx.listing.update({ where: { id: l.id }, data: { name: to } });
        changes.push({ table: "Listing", id: l.id, from: l.name, to });
      }
    }
    for (const pr of await tx.product.findMany({ select: { id: true, name: true } })) {
      const to = canonicalName(pr.name);
      if (to !== pr.name) {
        await tx.product.update({ where: { id: pr.id }, data: { name: to } });
        changes.push({ table: "Product", id: pr.id, from: pr.name, to });
      }
    }
    await tx.dataMigration.create({ data: { id: NAMES_ID, detail: JSON.stringify(changes) } });
    return changes;
  });
}

// ---------------------------------------------------------------- Policies and contact email
export const POLICIES_ID = "policies-and-contact-2026-11";
/**
 * Saved policy text that is still exactly the previous built-in default is replaced with the new default
 * (live shipping prices, payment methods, referral rules, [FILL IN] markers). A policy the owner edited
 * is left alone and listed in the detail. An empty contact email becomes support@buckshotlabs.com.
 * The old text is kept in the DataMigration row, so it can be put back.
 */
export async function updatePolicies(): Promise<{ replaced: string[]; kept: string[]; contactEmail: boolean } | null> {
  return prisma.$transaction(async (tx) => {
    if (await tx.dataMigration.findUnique({ where: { id: POLICIES_ID } })) return null;
    const row = await tx.settings.findUnique({ where: { id: 1 } });
    const saved = (row?.contentJson ? JSON.parse(row.contentJson) : {}) as { policies?: Record<string, { title?: string; body?: string; reviewed?: boolean }>; contact?: { email?: string } };
    const replaced: string[] = [];
    const kept: string[] = [];
    const before: Record<string, unknown> = {};
    for (const id of POLICY_IDS) {
      const cur = saved.policies?.[id];
      if (!cur) continue; // not saved: the new default already shows
      const old = (OLD_POLICIES as Record<string, { title: string; body: string }>)[id];
      const norm = (x?: string) => (x ?? "").split(String.fromCharCode(13)).join("").trim();
      const same = (a?: string, b?: string) => norm(a) === norm(b);
      if (same(cur.body, old.body) || cur.body === undefined) {
        before[id] = cur;
        saved.policies![id] = { ...DEFAULT_CONTENT.policies[id], reviewed: false, ...(same(cur.title, old.title) || !cur.title ? {} : { title: cur.title }) };
        replaced.push(id);
      } else kept.push(id);
    }
    const contactEmail = !!row && !(saved.contact?.email ?? "").trim();
    if (contactEmail) saved.contact = { ...(saved.contact ?? {}), email: SUPPORT_EMAIL };
    if (row && (replaced.length || contactEmail)) await tx.settings.update({ where: { id: 1 }, data: { contentJson: JSON.stringify(saved) } });
    await tx.dataMigration.create({ data: { id: POLICIES_ID, detail: JSON.stringify({ replaced, kept, contactEmail, before }) } });
    return { replaced, kept, contactEmail };
  });
}

export async function runDataMigrations() {
  try {
    const p = await updatePolicies();
    if (p) console.log(`[data] Policies updated: ${p.replaced.join(", ") || "none"}${p.kept.length ? `; edited by you, left alone: ${p.kept.join(", ")}` : ""}${p.contactEmail ? "; contact email set" : ""}`);
  } catch (e) {
    console.error("[data] policies failed:", e instanceof Error ? e.message : e);
  }
  try {
    const renamed = await canonicalProductNames();
    if (renamed?.length) console.log(`[data] Product names updated (${renamed.length}):${renamed.map((c) => `\n  ${c.from} -> ${c.to}`).join("")}`);
  } catch (e) {
    console.error("[data] product names failed:", e instanceof Error ? e.message : e);
  }
  try {
    const filled = await backfillSizes();
    if (filled) console.log(`[data] Sizes filled in from product names (${filled.length}):${filled.map((f) => `\n  ${f.product} -> ${f.size}`).join("")}`);
  } catch (e) {
    console.error("[data] size backfill failed:", e instanceof Error ? e.message : e);
  }
}
