-- Customers and payment methods.
-- Purely additive: new table + new columns with defaults. No table is rebuilt or dropped,
-- so every existing row (orders, lines, products, splits, payouts, settings) stays untouched.

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- New columns (existing orders get paymentMethod = 'Unknown' and no customer yet)
ALTER TABLE "Order" ADD COLUMN "customerId" TEXT REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'Unknown';
ALTER TABLE "Settings" ADD COLUMN "paymentMethods" TEXT NOT NULL DEFAULT '["Cash","Zelle","Cash App","Venmo","Apple Pay","Other"]';

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- Data: one customer per distinct order name, trimmed and matched case-insensitively
-- ("mike" and "Mike " become one customer). The spelling from the most recent order wins.
-- Orders with no name keep no customer.
INSERT INTO "Customer" ("id", "name", "phone", "notes", "createdAt")
SELECT lower(hex(randomblob(16))), "name", '', '', "firstDate"
FROM (
    SELECT
        trim("customer", char(32, 9, 10, 13)) AS "name",
        ROW_NUMBER() OVER (
            PARTITION BY lower(trim("customer", char(32, 9, 10, 13)))
            ORDER BY "date" DESC, "createdAt" DESC, "id" DESC
        ) AS "rn",
        MIN("date") OVER (PARTITION BY lower(trim("customer", char(32, 9, 10, 13)))) AS "firstDate"
    FROM "Order"
    WHERE trim("customer", char(32, 9, 10, 13)) <> ''
)
WHERE "rn" = 1;

-- Link each named order to its customer and normalize the name snapshot.
UPDATE "Order"
SET "customerId" = (
        SELECT c."id" FROM "Customer" c
        WHERE lower(c."name") = lower(trim("Order"."customer", char(32, 9, 10, 13)))
    )
WHERE trim("customer", char(32, 9, 10, 13)) <> '';

UPDATE "Order"
SET "customer" = (SELECT c."name" FROM "Customer" c WHERE c."id" = "Order"."customerId")
WHERE "customerId" IS NOT NULL;
