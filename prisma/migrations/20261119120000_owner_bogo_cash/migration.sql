-- Owner price, BOGO deals and cash tracking. Additive only: new nullable or defaulted columns and one
-- new table. Existing rows get "not an owner purchase", "no deal" and "cash holder not recorded",
-- so every existing stock and money total stays exactly the same.

-- Owner purchase: which partner bought at cost ("A" | "B"), null for normal sales.
ALTER TABLE "Order" ADD COLUMN "owner" TEXT;
-- Cash sales: who received the cash ("A" | "B"). Null = not recorded (older sales, non-cash sales).
ALTER TABLE "Order" ADD COLUMN "cashTo" TEXT;

ALTER TABLE "SavedOrder" ADD COLUMN "owner" TEXT;
ALTER TABLE "SavedOrder" ADD COLUMN "cashTo" TEXT;

-- A line discounted by a BOGO deal: the deal's id and name, and the price each before the deal.
ALTER TABLE "OrderLine" ADD COLUMN "dealId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OrderLine" ADD COLUMN "dealName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OrderLine" ADD COLUMN "fullPriceCents" INTEGER;

-- BOGO deals are promotions of kind "bogo"; their buy / get rule is JSON here.
ALTER TABLE "Promotion" ADD COLUMN "bogoJson" TEXT NOT NULL DEFAULT '';

-- Moving cash between the partners and the bank. Business money does not change, only where it sits.
CREATE TABLE "CashHandoff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "fromHolder" TEXT NOT NULL,
    "toHolder" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
