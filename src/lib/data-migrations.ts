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

// ---------------------------------------------------------------- Test order #1008
export const TEST_ORDER_ID = "remove-test-order-1008";
/** The one order to remove, matched on every field below so no real order can ever be hit. */
const TEST_ORDER = {
  id: "9f667fd9-9c3e-4302-aab5-3da931406aca",
  number: 1008,
  status: "canceled",
  cancelReason: "Canceled: test order",
  /** Its shipping label was bought on a Shippo TEST key (Shippo reports test: true): it cost nothing. */
  labelTransactionId: "1e0eaf8bd9ac484f9a7085d40dc64d31",
};

/**
 * Removes the canceled test order #1008, once, with its free test label. Canceled orders count for
 * nothing in money or stock, but the label was still subtracted from business money as a $5.49 expense
 * (label rows outlive their order: ON DELETE SET NULL), so the label row is removed too. The order has no
 * store credit, promotion or split rows (checked: if any appear, nothing is removed). Every removed row is
 * kept in the DataMigration detail so it can be put back.
 */
export async function removeTestOrder(): Promise<{ removed: boolean; why: string } | null> {
  return prisma.$transaction(async (tx) => {
    if (await tx.dataMigration.findUnique({ where: { id: TEST_ORDER_ID } })) return null;
    const done = async (removed: boolean, why: string, detail: unknown = {}) => {
      await tx.dataMigration.create({ data: { id: TEST_ORDER_ID, detail: JSON.stringify({ removed, why, ...((detail as object) ?? {}) }) } });
      return { removed, why };
    };
    const order = await tx.order.findUnique({ where: { id: TEST_ORDER.id }, include: { lines: true, events: true } });
    if (!order) return done(false, "order not found");
    if (order.number !== TEST_ORDER.number || order.status !== TEST_ORDER.status || order.cancelReason !== TEST_ORDER.cancelReason || order.source !== "online") {
      return done(false, "order does not match the test order");
    }
    const [labels, credit, promo, splits] = await Promise.all([
      tx.labelPurchase.findMany({ where: { orderId: order.id } }),
      tx.creditEntry.count({ where: { orderId: order.id } }),
      tx.promotionUse.count({ where: { orderId: order.id } }),
      tx.splitItem.count({ where: { orderId: order.id } }),
    ]);
    if (credit || promo || splits) return done(false, "order has credit, promotion or split rows");
    if (labels.some((l) => l.shippoTransactionId !== TEST_ORDER.labelTransactionId)) return done(false, "order has an unexpected label");
    await tx.labelPurchase.deleteMany({ where: { orderId: order.id, shippoTransactionId: TEST_ORDER.labelTransactionId } });
    await tx.order.delete({ where: { id: order.id } }); // lines and events cascade
    return done(true, "removed", { order, labels });
  });
}

export async function runDataMigrations() {
  try {
    const t = await removeTestOrder();
    if (t) console.log(`[data] Test order #1008: ${t.why}`);
  } catch (e) {
    console.error("[data] test order removal failed:", e instanceof Error ? e.message : e);
  }
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
