-- Server-side carts for signed-in customers, and a lock so a shipping label is never bought twice.
-- Additive only: one new table and one nullable column. No existing customer, order, code or credit row changes.
CREATE TABLE "CustomerCart" (
    "customerId" TEXT NOT NULL PRIMARY KEY,
    "itemsJson" TEXT NOT NULL DEFAULT '[]',
    "code" TEXT NOT NULL DEFAULT '',
    "referral" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerCart_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "Order" ADD COLUMN "labelLockAt" DATETIME;
