-- Customer reviews: public page, guest reviews, photos, automatic review request. Additive only:
-- new columns with defaults, one new table, indexes. No DROP, no table rebuild.
ALTER TABLE "Order" ADD COLUMN "reviewRequestSentAt" DATETIME;

ALTER TABLE "Review" ADD COLUMN "title" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Review" ADD COLUMN "email" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Review" ADD COLUMN "flagReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Review" ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Review" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'email_link';
ALTER TABLE "Review" ADD COLUMN "ipHash" TEXT NOT NULL DEFAULT '';

-- Every review so far came through the secret link in the order email, so it is a verified order.
UPDATE "Review" SET "verified" = true WHERE "orderId" IS NOT NULL;
-- Keep each existing review's email for the per-email checks.
UPDATE "Review" SET "email" = COALESCE((SELECT lower("Order"."email") FROM "Order" WHERE "Order"."id" = "Review"."orderId"), '') WHERE "orderId" IS NOT NULL;
-- Orders that already got the old "How was your order?" email (sent at delivery) never get a second request.
UPDATE "Order" SET "reviewRequestSentAt" = COALESCE("deliveredAt", CURRENT_TIMESTAMP) WHERE "reviewToken" IS NOT NULL AND "status" IN ('delivered', 'picked_up');

CREATE TABLE "ReviewPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reviewId" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewPhoto_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ReviewPhoto_reviewId_idx" ON "ReviewPhoto"("reviewId");
CREATE INDEX "Review_email_createdAt_idx" ON "Review"("email", "createdAt");
CREATE INDEX "Review_ipHash_createdAt_idx" ON "Review"("ipHash", "createdAt");
