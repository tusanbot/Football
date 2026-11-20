CREATE TYPE "ChallengeChargeAsset" AS ENUM ('FREE', 'GOLD', 'PURCHASED');

ALTER TABLE "FriendlyChallenge"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "chargeAsset" "ChallengeChargeAsset" NOT NULL DEFAULT 'FREE',
  ADD COLUMN "goldCost" BIGINT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "FriendlyChallenge_idempotencyKey_key"
  ON "FriendlyChallenge"("idempotencyKey");
