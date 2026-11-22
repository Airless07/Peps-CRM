-- Referral program. Additive only: new columns with defaults, two new tables, triggers.
-- No existing customer, code, credit entry or money total is lost or changed, except:
--   * a customer referral code that is identical to an existing discount code is cleared (the app
--     gives that customer a fresh code at start-up), so the two kinds can share one namespace.

-- Orders: the code and the rates used at the time of the order, the buyer discount, and refunds.
ALTER TABLE "Order" ADD COLUMN "referralCode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "referralRatePct" REAL;
ALTER TABLE "Order" ADD COLUMN "referralDiscountPct" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "referralDiscountCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "refundedCents" INTEGER NOT NULL DEFAULT 0;

-- Existing referred orders keep the referral percent that is in Settings today (the % they were placed with)
-- and show the referrer's current code.
UPDATE "Order"
SET "referralRatePct" = COALESCE((SELECT json_extract("storeJson", '$.referrals.percent') FROM "Settings" WHERE "id" = 1), 10)
WHERE "referredById" IS NOT NULL AND "referralRatePct" IS NULL;
UPDATE "Order"
SET "referralCode" = COALESCE((SELECT "referralCode" FROM "Customer" WHERE "Customer"."id" = "Order"."referredById"), '')
WHERE "referredById" IS NOT NULL AND "referralCode" = '';

-- Customers: the code as typed (display), plus code change history.
ALTER TABLE "Customer" ADD COLUMN "referralCodeDisplay" TEXT;

CREATE TABLE "ReferralCodeChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "oldCode" TEXT NOT NULL,
    "newCode" TEXT NOT NULL,
    "by" TEXT NOT NULL DEFAULT '',
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralCodeChange_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ReferralCodeChange_customerId_idx" ON "ReferralCodeChange"("customerId");

-- Pending referral credit: in the history, not in the spendable balance.
ALTER TABLE "CreditEntry" ADD COLUMN "pending" BOOLEAN NOT NULL DEFAULT false;

-- One namespace for every code a customer can type. The PRIMARY KEY is the uniqueness guarantee.
CREATE TABLE "CodeClaim" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "customerId" TEXT,
    "promotionId" TEXT
);
CREATE INDEX "CodeClaim_customerId_idx" ON "CodeClaim"("customerId");
CREATE INDEX "CodeClaim_promotionId_idx" ON "CodeClaim"("promotionId");

-- Discount codes first (the team picked them), then referral codes. A referral code equal to a
-- discount code is cleared so it can be regenerated.
INSERT OR IGNORE INTO "CodeClaim" ("code", "kind", "promotionId")
  SELECT UPPER("code"), 'promo', "id" FROM "Promotion" WHERE "kind" = 'code' AND "code" <> '';
UPDATE "Customer" SET "referralCode" = NULL
  WHERE "referralCode" IS NOT NULL AND UPPER("referralCode") IN (SELECT "code" FROM "CodeClaim" WHERE "kind" = 'promo');
UPDATE "Customer" SET "referralCode" = UPPER("referralCode") WHERE "referralCode" IS NOT NULL AND "referralCode" <> UPPER("referralCode");
INSERT OR IGNORE INTO "CodeClaim" ("code", "kind", "customerId")
  SELECT "referralCode", 'referral', "id" FROM "Customer" WHERE "referralCode" IS NOT NULL;

-- Keep CodeClaim in sync on every write, whatever code path does it (app, restore, import).
-- A clash makes the INSERT fail with "UNIQUE constraint failed: CodeClaim.code" and aborts the write.
CREATE TRIGGER "customer_code_insert" AFTER INSERT ON "Customer"
WHEN NEW."referralCode" IS NOT NULL
BEGIN
  INSERT INTO "CodeClaim" ("code", "kind", "customerId") VALUES (NEW."referralCode", 'referral', NEW."id");
END;

CREATE TRIGGER "customer_code_update" AFTER UPDATE OF "referralCode" ON "Customer"
WHEN OLD."referralCode" IS NOT NEW."referralCode"
BEGIN
  DELETE FROM "CodeClaim" WHERE "customerId" = OLD."id";
  INSERT INTO "CodeClaim" ("code", "kind", "customerId") SELECT NEW."referralCode", 'referral', NEW."id" WHERE NEW."referralCode" IS NOT NULL;
END;

CREATE TRIGGER "customer_code_delete" AFTER DELETE ON "Customer"
BEGIN
  DELETE FROM "CodeClaim" WHERE "customerId" = OLD."id";
END;

CREATE TRIGGER "promotion_code_insert" AFTER INSERT ON "Promotion"
WHEN NEW."kind" = 'code' AND NEW."code" <> ''
BEGIN
  INSERT INTO "CodeClaim" ("code", "kind", "promotionId") VALUES (UPPER(NEW."code"), 'promo', NEW."id");
END;

CREATE TRIGGER "promotion_code_update" AFTER UPDATE OF "code", "kind" ON "Promotion"
BEGIN
  DELETE FROM "CodeClaim" WHERE "promotionId" = OLD."id";
  INSERT INTO "CodeClaim" ("code", "kind", "promotionId") SELECT UPPER(NEW."code"), 'promo', NEW."id" WHERE NEW."kind" = 'code' AND NEW."code" <> '';
END;

CREATE TRIGGER "promotion_code_delete" AFTER DELETE ON "Promotion"
BEGIN
  DELETE FROM "CodeClaim" WHERE "promotionId" = OLD."id";
END;
