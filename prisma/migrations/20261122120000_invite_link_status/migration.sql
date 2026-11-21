-- Invite link status on the customer page ("Link created ..., expires ...", "Claimed ... with ...", "Expired").
-- Additive only: three nullable columns. No existing row or money total changes.
ALTER TABLE "Customer" ADD COLUMN "inviteCreatedAt" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "inviteClaimedAt" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "inviteClaimedEmail" TEXT;
