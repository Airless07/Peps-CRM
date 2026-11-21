-- Customer accounts, store credit and referrals. Additive only: new nullable or defaulted columns and
-- one new table. Every existing order gets 0 store credit and no referrer, so every existing stock and
-- money total stays exactly the same. No existing row is changed.

-- Orders: store credit used (works like a discount) and who referred the sale.
ALTER TABLE "Order" ADD COLUMN "storeCreditCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "referredById" TEXT;

ALTER TABLE "SavedOrder" ADD COLUMN "storeCreditCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SavedOrder" ADD COLUMN "referredById" TEXT;

-- Customers: invite / claim link, temporary password flag, last login, referral code and referrer.
ALTER TABLE "Customer" ADD COLUMN "inviteTokenHash" TEXT;
ALTER TABLE "Customer" ADD COLUMN "inviteExpiresAt" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN "lastLoginAt" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "referralCode" TEXT;
ALTER TABLE "Customer" ADD COLUMN "referredById" TEXT;
-- NULLs never clash, so existing customers (no code yet) are fine. Codes are filled in by the app.
CREATE UNIQUE INDEX "Customer_referralCode_key" ON "Customer"("referralCode");

-- Store credit history. A balance is the sum of its entries.
CREATE TABLE "CreditEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amountCents" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "orderId" TEXT,
    "orderNumber" INTEGER,
    "by" TEXT NOT NULL DEFAULT '',
    "shortfallCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CreditEntry_customerId_idx" ON "CreditEntry"("customerId");
CREATE INDEX "CreditEntry_orderId_idx" ON "CreditEntry"("orderId");
