-- Admin sessions can be ended everywhere, and optional two-step sign in (TOTP). Additive only.
ALTER TABLE "Settings" ADD COLUMN "adminSessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Settings" ADD COLUMN "totpSecret" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Settings" ADD COLUMN "totpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN "totpLastStep" INTEGER NOT NULL DEFAULT 0;
