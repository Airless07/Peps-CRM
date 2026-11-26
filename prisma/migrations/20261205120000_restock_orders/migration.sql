-- Restock orders. Additive only: two new tables and two nullable columns on Purchase. Existing restocks
-- keep NULL (not part of an order), so every current stock, cost and money number stays the same.
ALTER TABLE "Purchase" ADD COLUMN "restockOrderId" TEXT;
ALTER TABLE "Purchase" ADD COLUMN "listCents" INTEGER;

CREATE TABLE "RestockOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "supplier" TEXT NOT NULL DEFAULT '',
    "lot" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "paidBy" TEXT NOT NULL,
    "shippingCents" INTEGER NOT NULL DEFAULT 0,
    "shippingDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "feeMode" TEXT NOT NULL DEFAULT 'amount',
    "feeValue" INTEGER NOT NULL DEFAULT 0,
    "file" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT NOT NULL DEFAULT '',
    "mime" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "RestockEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "restockId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT ''
);

CREATE INDEX "RestockEvent_restockId_idx" ON "RestockEvent"("restockId");
