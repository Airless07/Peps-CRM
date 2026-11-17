-- Additive only: one new table and one new column with a default. Nothing existing is changed.

-- In-person orders saved for later on the Sell screen. They are NOT orders yet:
-- no stock or money effect until completed (then a normal Order row is created and this row is removed).
CREATE TABLE "SavedOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customer" TEXT NOT NULL DEFAULT '',
    "customerId" TEXT,
    "paymentMethod" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "soldBy" TEXT NOT NULL DEFAULT 'A',
    "discountType" TEXT NOT NULL DEFAULT '$',
    "discountValue" REAL NOT NULL DEFAULT 0,
    "tipCents" INTEGER NOT NULL DEFAULT 0,
    "linesJson" TEXT NOT NULL DEFAULT '[]',
    "savedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Quick discount and tip buttons in the Sell cart. Empty = the built-in defaults.
ALTER TABLE "Settings" ADD COLUMN "sellButtonsJson" TEXT NOT NULL DEFAULT '';
