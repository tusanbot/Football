ALTER TABLE "Player" ADD COLUMN "marketValue" BIGINT NOT NULL DEFAULT 1000;
CREATE TABLE "LeagueAward" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "season" INTEGER NOT NULL,
  "tier" INTEGER NOT NULL,
  "placement" INTEGER NOT NULL,
  "awardName" TEXT NOT NULL,
  "awardType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeagueAward_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeagueAward_leagueId_placement_key" ON "LeagueAward"("leagueId", "placement");
CREATE INDEX "LeagueAward_clubId_season_tier_idx" ON "LeagueAward"("clubId", "season", "tier");
ALTER TABLE "LeagueAward" ADD CONSTRAINT "LeagueAward_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "PyramidLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeagueAward" ADD CONSTRAINT "LeagueAward_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
