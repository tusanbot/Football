ALTER TABLE "LeaguePromotionOffer" ADD COLUMN "expiresAt" TIMESTAMP(3);
UPDATE "LeaguePromotionOffer" SET "expiresAt" = "offeredAt" + INTERVAL '24 hours';
ALTER TABLE "LeaguePromotionOffer" ALTER COLUMN "expiresAt" SET NOT NULL;
CREATE INDEX "LeaguePromotionOffer_status_expiresAt_idx" ON "LeaguePromotionOffer"("status", "expiresAt");
