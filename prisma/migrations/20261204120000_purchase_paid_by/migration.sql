-- Restocks: who paid ("A" | "B" | "bank"). Additive: existing rows stay NULL = paid from the bank, as before,
-- so every existing money and cash-held number stays the same.
ALTER TABLE "Purchase" ADD COLUMN "paidBy" TEXT;
