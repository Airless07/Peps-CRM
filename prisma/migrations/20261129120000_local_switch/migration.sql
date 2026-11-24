-- Switch a shipped order to local pickup / delivery from the admin. Additive only: one new column with a default.
ALTER TABLE "Order" ADD COLUMN "localSwitchJson" TEXT NOT NULL DEFAULT '';
