/**
 * Shows which sizes the one-time "sizes from product names" fill-in sets, WITHOUT changing anything.
 * Reads a database read-only (default data/peps.db; or pass a path). The real fill-in runs once at
 * server start (src/lib/data-migrations.ts) and is listed in the admin on the Inventory page.
 *
 *   npx tsx scripts/size-backfill-report.ts [path/to/db]
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { planSizeBackfill } from "../src/lib/data-migrations";

const file = process.argv[2] ?? path.join(import.meta.dirname, "..", "data", "peps.db");
const db = new DatabaseSync(file, { readOnly: true });
const products = db.prepare(`select id, name, "variantLabel", "listingId" from "Product" order by "sortOrder", "createdAt"`).all() as { id: string; name: string; variantLabel: string; listingId: string | null }[];
const listings = db.prepare(`select id, name from "Listing"`).all() as { id: string; name: string }[];
const plan = planSizeBackfill(products, listings);
const filled = new Set(plan.map((f) => f.productId));
console.log(`Database: ${file}\n`);
console.log(`Filled in (${plan.length}):`);
for (const f of plan) console.log(`  ${f.product.padEnd(32)} -> ${f.size}`);
const already = products.filter((p) => p.variantLabel.trim());
console.log(`\nAlready had a size, unchanged (${already.length}):`);
for (const p of already) console.log(`  ${p.name.padEnd(32)}    ${p.variantLabel}`);
const blank = products.filter((p) => !p.variantLabel.trim() && !filled.has(p.id));
console.log(`\nNo size found in the name, left blank (${blank.length}):`);
for (const p of blank) console.log(`  ${p.name}`);
