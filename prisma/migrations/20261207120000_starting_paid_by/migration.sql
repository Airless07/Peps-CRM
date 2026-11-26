-- Who paid the starting balance (the first restock). Additive: NULL = the bank, as before.
ALTER TABLE "Settings" ADD COLUMN "startingPaidBy" TEXT;
