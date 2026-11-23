-- Checkout consent on website orders: when it was ticked, the exact text, and the buyer's IP. Additive only.
ALTER TABLE "Order" ADD COLUMN "consentAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "consentText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "consentIp" TEXT NOT NULL DEFAULT '';
