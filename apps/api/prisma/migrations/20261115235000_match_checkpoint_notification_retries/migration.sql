ALTER TABLE "MatchTacticalCheckpoint"
  ADD COLUMN "homeBotNotificationClaimedAt" TIMESTAMP(3),
  ADD COLUMN "awayBotNotificationClaimedAt" TIMESTAMP(3),
  ADD COLUMN "homeBotNotificationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "awayBotNotificationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "homeBotNotificationLastError" TEXT,
  ADD COLUMN "awayBotNotificationLastError" TEXT;
