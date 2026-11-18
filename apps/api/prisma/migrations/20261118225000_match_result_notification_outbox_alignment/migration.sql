-- Bring older staging databases in line with the MatchResultNotification Prisma model.
CREATE TABLE IF NOT EXISTS "MatchResultNotification" (
  "id" TEXT NOT NULL, "matchId" TEXT NOT NULL, "channel" TEXT NOT NULL, "telegramChatId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lockedUntil" TIMESTAMP(3),
  "claimToken" TEXT, "lastError" TEXT, "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatchResultNotification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MatchResultNotification_matchId_channel_key" ON "MatchResultNotification"("matchId", "channel");
CREATE INDEX IF NOT EXISTS "MatchResultNotification_status_availableAt_lockedUntil_idx" ON "MatchResultNotification"("status", "availableAt", "lockedUntil");
CREATE INDEX IF NOT EXISTS "MatchResultNotification_telegramChatId_createdAt_idx" ON "MatchResultNotification"("telegramChatId", "createdAt");
DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MatchResultNotification_matchId_fkey') THEN
    ALTER TABLE "MatchResultNotification" ADD CONSTRAINT "MatchResultNotification_matchId_fkey"
      FOREIGN KEY ("matchId") REFERENCES "FootballMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$fk$;
ALTER TABLE "MatchResultNotification" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MatchResultNotification" FROM PUBLIC, anon, authenticated;
