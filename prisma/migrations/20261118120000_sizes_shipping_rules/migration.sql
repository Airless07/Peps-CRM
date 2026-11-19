-- Additive only: two new columns with defaults, one new table, and one UPDATE that writes only a new column. No existing value is changed or removed.

-- Optional vial volume shown next to the size ("10mg · 3ml").
ALTER TABLE "Product" ADD COLUMN "vialVolume" TEXT NOT NULL DEFAULT '';

-- One-time data fixes run by the app at startup (src/lib/data-migrations.ts). A row = already ran.
-- "sizes-from-names": fills an EMPTY size label from the size written in the product name ("GHK-Cu 100mg" gives "100mg").
CREATE TABLE "DataMigration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ranAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detail" TEXT NOT NULL DEFAULT ''
);

-- Free shipping rules choose which shipping options they make free (Standard, Priority, Express).
ALTER TABLE "Promotion" ADD COLUMN "shippingTiersJson" TEXT NOT NULL DEFAULT '[]';
-- Existing free shipping rules (the "Free shipping on orders $100+" rule) apply to Standard only.
UPDATE "Promotion" SET "shippingTiersJson" = '["standard"]' WHERE "kind" = 'free_shipping';
