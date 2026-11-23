-- Sign out ends the session on the server too. Additive only: one new table.
CREATE TABLE "RevokedSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL
);
CREATE INDEX "RevokedSession_expiresAt_idx" ON "RevokedSession"("expiresAt");
