-- Buckshot Peps store.
-- Purely additive: new tables + new columns with defaults. No table is rebuilt or dropped,
-- so every existing row (orders, lines, products, purchases, splits, payouts, settings) stays untouched.
-- Money: new columns default to values that leave computeLedger() results identical
-- (shippingCents = 0, no label purchases, status = 'completed').

-- ---------------------------------------------------------------- Settings
ALTER TABLE "Settings" ADD COLUMN "storeJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "Settings" ADD COLUMN "contentJson" TEXT NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------- New tables
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "casNumber" TEXT NOT NULL DEFAULT '',
    "formula" TEXT NOT NULL DEFAULT '',
    "molecularWeight" TEXT NOT NULL DEFAULT '',
    "purity" TEXT NOT NULL DEFAULT '',
    "form" TEXT NOT NULL DEFAULT '',
    "storage" TEXT NOT NULL DEFAULT '',
    "showOnWebsite" BOOLEAN NOT NULL DEFAULT false,
    "photosJson" TEXT NOT NULL DEFAULT '[]',
    "hoverGif" TEXT NOT NULL DEFAULT '',
    "groupsJson" TEXT NOT NULL DEFAULT '[]',
    "badgesJson" TEXT NOT NULL DEFAULT '[]',
    "bestSeller" BOOLEAN NOT NULL DEFAULT false,
    "qtyDealsJson" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "seoTitle" TEXT NOT NULL DEFAULT '',
    "seoDescription" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ProductGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Coa" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "fileName" TEXT NOT NULL DEFAULT '',
    "mime" TEXT NOT NULL DEFAULT '',
    "lot" TEXT NOT NULL DEFAULT '',
    "testDate" DATETIME,
    "purity" TEXT NOT NULL DEFAULT '',
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Coa_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Coa_productId_idx" ON "Coa"("productId");

CREATE TABLE "LabelPurchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT,
    "date" DATETIME NOT NULL,
    "costCents" INTEGER NOT NULL,
    "carrier" TEXT NOT NULL DEFAULT '',
    "service" TEXT NOT NULL DEFAULT '',
    "trackingNumber" TEXT NOT NULL DEFAULT '',
    "labelUrl" TEXT NOT NULL DEFAULT '',
    "shippoTransactionId" TEXT NOT NULL DEFAULT '',
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabelPurchase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "LabelPurchase_orderId_idx" ON "LabelPurchase"("orderId");

CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL DEFAULT 'status',
    "message" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OrderEvent_orderId_idx" ON "OrderEvent"("orderId");

CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL DEFAULT '',
    "discountType" TEXT NOT NULL DEFAULT '$',
    "discountValue" REAL NOT NULL DEFAULT 0,
    "minSubtotalCents" INTEGER NOT NULL DEFAULT 0,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "maxUses" INTEGER,
    "oncePerEmail" BOOLEAN NOT NULL DEFAULT false,
    "listingIdsJson" TEXT NOT NULL DEFAULT '[]',
    "groupIdsJson" TEXT NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "PromotionUse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promotionId" TEXT NOT NULL,
    "orderId" TEXT,
    "email" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromotionUse_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PromotionUse_promotionId_idx" ON "PromotionUse"("promotionId");
CREATE INDEX "PromotionUse_orderId_idx" ON "PromotionUse"("orderId");

CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "displayName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Review_orderId_key" ON "Review"("orderId");

CREATE TABLE "ContactMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------- Product (variant) columns
ALTER TABLE "Product" ADD COLUMN "listingId" TEXT REFERENCES "Listing" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD COLUMN "variantLabel" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN "variantSort" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "weightOz" REAL;
ALTER TABLE "Product" ADD COLUMN "testingStatus" TEXT NOT NULL DEFAULT 'coming_soon';
CREATE INDEX "Product_listingId_idx" ON "Product"("listingId");

-- ---------------------------------------------------------------- Customer
ALTER TABLE "Customer" ADD COLUMN "email" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Customer" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "Customer" ADD COLUMN "addressesJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Customer" ADD COLUMN "resetTokenHash" TEXT;
ALTER TABLE "Customer" ADD COLUMN "resetExpiresAt" DATETIME;

-- ---------------------------------------------------------------- Order columns
ALTER TABLE "Order" ADD COLUMN "number" INTEGER;
ALTER TABLE "Order" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'inperson';
ALTER TABLE "Order" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE "Order" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "email" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "phone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "shipToJson" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "shippingCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "shippingMethod" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "shippingRateJson" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "promoJson" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "payChoice" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "shippingTier" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "token" TEXT;
ALTER TABLE "Order" ADD COLUMN "reviewToken" TEXT;
ALTER TABLE "Order" ADD COLUMN "screenshotFile" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "cancelReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "placedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "expiresAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "paidAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "shippedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "deliveredAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "canceledAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "trackingNumber" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "trackingCarrier" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "trackingStatus" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "labelUrl" TEXT NOT NULL DEFAULT '';

-- ---------------------------------------------------------------- Data
-- Every existing product becomes a single-variant product: one Listing per Product.
-- Hidden from the website until switched on. Slugs are filled in by the app on first start.
INSERT INTO "Listing" ("id", "name", "sortOrder", "createdAt")
SELECT 'l-' || "id", "name", "sortOrder", "createdAt" FROM "Product";

UPDATE "Product" SET "listingId" = 'l-' || "id";

-- Order numbers: existing orders get 1001, 1002, ... in date order.
UPDATE "Order"
SET "number" = (
    SELECT n."num" FROM (
        SELECT "id", 1000 + ROW_NUMBER() OVER (ORDER BY "date" ASC, "createdAt" ASC, "id" ASC) AS "num"
        FROM "Order"
    ) n WHERE n."id" = "Order"."id"
);

CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");
CREATE UNIQUE INDEX "Order_token_key" ON "Order"("token");
CREATE UNIQUE INDEX "Order_reviewToken_key" ON "Order"("reviewToken");
CREATE INDEX "Order_status_idx" ON "Order"("status");
