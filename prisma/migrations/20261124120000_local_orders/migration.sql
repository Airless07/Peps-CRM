-- Local pickup and local delivery. Additive only: new columns with defaults. Every existing order
-- becomes fulfillment 'ship' (what it already is); no existing row, stock or money total changes.
ALTER TABLE "Order" ADD COLUMN "fulfillment" TEXT NOT NULL DEFAULT 'ship';
ALTER TABLE "Order" ADD COLUMN "localTime" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "localNotes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "localJson" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "payAtPickup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "readyAt" DATETIME;
