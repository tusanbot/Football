CREATE TABLE "MatchLifecycleNotification" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "minute" INTEGER NOT NULL,
  "homeScore" INTEGER NOT NULL DEFAULT 0,
  "awayScore" INTEGER NOT NULL DEFAULT 0,
  "telegramChatId" TEXT NOT NULL,
  "payload" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" TIMESTAMP(3),
  "claimToken" TEXT,
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatchLifecycleNotification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MatchLifecycleNotification_matchId_channel_eventKey_key"
ON "MatchLifecycleNotification"("matchId", "channel", "eventKey");
CREATE INDEX "MatchLifecycleNotification_status_availableAt_lockedUntil_idx"
ON "MatchLifecycleNotification"("status", "availableAt", "lockedUntil");
CREATE INDEX "MatchLifecycleNotification_telegramChatId_createdAt_idx"
ON "MatchLifecycleNotification"("telegramChatId", "createdAt");
ALTER TABLE "MatchLifecycleNotification"
ADD CONSTRAINT "MatchLifecycleNotification_matchId_fkey"
FOREIGN KEY ("matchId") REFERENCES "FootballMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchLifecycleNotification" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "MatchLifecycleNotification" FROM PUBLIC, anon, authenticated;
