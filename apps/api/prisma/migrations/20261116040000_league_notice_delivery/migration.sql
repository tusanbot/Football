ALTER TABLE "LeagueNotice"
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryClaimToken" TEXT,
  ADD COLUMN "deliveryLockedUntil" TIMESTAMP(3),
  ADD COLUMN "deliveryLastError" TEXT;
CREATE INDEX "LeagueNotice_deliveredAt_deliveryLockedUntil_createdAt_idx"
  ON "LeagueNotice"("deliveredAt", "deliveryLockedUntil", "createdAt");
