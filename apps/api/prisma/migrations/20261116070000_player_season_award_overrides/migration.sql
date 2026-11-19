CREATE TABLE "SeasonPlayerAward" (
  "id" TEXT NOT NULL,
  "season" INTEGER NOT NULL,
  "playerId" TEXT NOT NULL,
  "awardType" TEXT NOT NULL,
  "awardName" TEXT NOT NULL,
  "reason" TEXT,
  "createdByTelegramId" TEXT NOT NULL,
  "updatedByTelegramId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeasonPlayerAward_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SeasonPlayerAward_season_playerId_awardType_key" ON "SeasonPlayerAward"("season", "playerId", "awardType");
CREATE INDEX "SeasonPlayerAward_season_awardType_idx" ON "SeasonPlayerAward"("season", "awardType");
CREATE INDEX "SeasonPlayerAward_playerId_season_idx" ON "SeasonPlayerAward"("playerId", "season");
ALTER TABLE "SeasonPlayerAward" ADD CONSTRAINT "SeasonPlayerAward_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
