DROP INDEX "Player_specialPlayerId_key";
CREATE INDEX "Player_specialPlayerId_idx" ON "Player"("specialPlayerId");
CREATE UNIQUE INDEX "Player_clubId_specialPlayerId_key" ON "Player"("clubId", "specialPlayerId");

CREATE TABLE "SpecialPlayerAcquisition" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "specialPlayerId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "asset" "WalletAsset" NOT NULL DEFAULT 'GOLD',
  "amount" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpecialPlayerAcquisition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpecialPlayerAcquisition_idempotencyKey_key" ON "SpecialPlayerAcquisition"("idempotencyKey");
CREATE UNIQUE INDEX "SpecialPlayerAcquisition_playerId_key" ON "SpecialPlayerAcquisition"("playerId");
CREATE INDEX "SpecialPlayerAcquisition_userId_createdAt_idx" ON "SpecialPlayerAcquisition"("userId", "createdAt");
CREATE INDEX "SpecialPlayerAcquisition_clubId_createdAt_idx" ON "SpecialPlayerAcquisition"("clubId", "createdAt");
CREATE INDEX "SpecialPlayerAcquisition_specialPlayerId_createdAt_idx" ON "SpecialPlayerAcquisition"("specialPlayerId", "createdAt");

ALTER TABLE "SpecialPlayerAcquisition"
  ADD CONSTRAINT "SpecialPlayerAcquisition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SpecialPlayerAcquisition_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SpecialPlayerAcquisition_specialPlayerId_fkey" FOREIGN KEY ("specialPlayerId") REFERENCES "SpecialPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SpecialPlayerAcquisition_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
