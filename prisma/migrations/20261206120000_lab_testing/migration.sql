-- Lab testing adjustments. Additive only: new defaulted / nullable columns on StockAdjustment.
-- Existing adjustments get empty values and $0 testing cost; stock and money stay the same.
ALTER TABLE "StockAdjustment" ADD COLUMN "lab" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StockAdjustment" ADD COLUMN "sampleId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StockAdjustment" ADD COLUMN "lot" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StockAdjustment" ADD COLUMN "expenseId" TEXT;
ALTER TABLE "StockAdjustment" ADD COLUMN "shipmentId" TEXT;
ALTER TABLE "StockAdjustment" ADD COLUMN "costCents" INTEGER NOT NULL DEFAULT 0;
