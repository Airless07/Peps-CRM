-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "startingBalanceCents" INTEGER NOT NULL DEFAULT -130000,
    "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessCutPercent" REAL NOT NULL DEFAULT 10,
    "partnerAName" TEXT NOT NULL DEFAULT 'Ahmad',
    "partnerBName" TEXT NOT NULL DEFAULT 'Mo',
    "partnerARatio" REAL NOT NULL DEFAULT 50,
    "tipHandling" TEXT NOT NULL DEFAULT 'profit',
    "defaultSoldBy" TEXT NOT NULL DEFAULT 'A',
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 3,
    "passwordHash" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "defaultPriceCents" INTEGER NOT NULL DEFAULT 0,
    "costOverrideCents" INTEGER,
    "lowStockThreshold" INTEGER,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "totalCostCents" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "fromInvestment" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Purchase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'correction',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockAdjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "customer" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "soldBy" TEXT NOT NULL DEFAULT 'A',
    "discountType" TEXT NOT NULL DEFAULT '$',
    "discountValue" REAL NOT NULL DEFAULT 0,
    "tipCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "unitCostCents" INTEGER NOT NULL,
    "cutPercent" REAL NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Split" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "partnerACents" INTEGER NOT NULL,
    "partnerBCents" INTEGER NOT NULL,
    "businessCents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SplitItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "splitId" TEXT NOT NULL,
    "orderId" TEXT,
    "partnerACents" INTEGER NOT NULL,
    "partnerBCents" INTEGER NOT NULL,
    "businessCents" INTEGER NOT NULL,
    CONSTRAINT "SplitItem_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "Split" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SplitItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "person" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "splitId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payout_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "Split" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Purchase_productId_idx" ON "Purchase"("productId");

-- CreateIndex
CREATE INDEX "StockAdjustment_productId_idx" ON "StockAdjustment"("productId");

-- CreateIndex
CREATE INDEX "Order_date_idx" ON "Order"("date");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE INDEX "SplitItem_splitId_idx" ON "SplitItem"("splitId");

-- CreateIndex
CREATE INDEX "SplitItem_orderId_idx" ON "SplitItem"("orderId");

