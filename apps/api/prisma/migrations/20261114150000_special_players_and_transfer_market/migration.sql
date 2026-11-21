CREATE TYPE "SpecialRarity" AS ENUM ('RARE', 'EPIC', 'LEGENDARY', 'ICON');
CREATE TYPE "MarketListingStatus" AS ENUM ('OPEN', 'SOLD', 'CANCELLED', 'EXPIRED');

ALTER TABLE "SpecialPlayer"
  ADD COLUMN "rarity" "SpecialRarity" NOT NULL DEFAULT 'RARE',
  ADD COLUMN "acquisitionMethods" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "PlayerMarketListing" (
  "id" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "sellerClubId" TEXT NOT NULL,
  "buyerClubId" TEXT,
  "askingPrice" BIGINT NOT NULL,
  "status" "MarketListingStatus" NOT NULL DEFAULT 'OPEN',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerMarketListing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlayerMarketListing_status_expiresAt_createdAt_idx"
  ON "PlayerMarketListing"("status", "expiresAt", "createdAt");
CREATE INDEX "PlayerMarketListing_sellerClubId_status_idx"
  ON "PlayerMarketListing"("sellerClubId", "status");
CREATE INDEX "PlayerMarketListing_playerId_status_idx"
  ON "PlayerMarketListing"("playerId", "status");

ALTER TABLE "PlayerMarketListing"
  ADD CONSTRAINT "PlayerMarketListing_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PlayerMarketListing_sellerClubId_fkey"
    FOREIGN KEY ("sellerClubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PlayerMarketListing_buyerClubId_fkey"
    FOREIGN KEY ("buyerClubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
