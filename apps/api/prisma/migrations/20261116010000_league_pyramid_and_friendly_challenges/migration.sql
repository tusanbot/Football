CREATE TYPE "LeagueApplicationStatus" AS ENUM ('QUEUED', 'ASSIGNED', 'WITHDRAWN');
CREATE TYPE "PromotionOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REPLACED');
CREATE TYPE "FriendlyChallengeStatus" AS ENUM ('OPEN', 'ACCEPTED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "PyramidLeague" (
  "id" TEXT NOT NULL,
  "competitionId" TEXT NOT NULL,
  "tier" INTEGER NOT NULL,
  "season" INTEGER NOT NULL,
  "groupNumber" INTEGER NOT NULL,
  "promotionProcessedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PyramidLeague_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PyramidLeagueEntry" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalPosition" INTEGER,
  CONSTRAINT "PyramidLeagueEntry_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PyramidLeagueApplication" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "tier" INTEGER NOT NULL,
  "season" INTEGER NOT NULL,
  "status" "LeagueApplicationStatus" NOT NULL DEFAULT 'QUEUED',
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedLeagueId" TEXT,
  CONSTRAINT "PyramidLeagueApplication_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LeaguePromotionOffer" (
  "id" TEXT NOT NULL,
  "leagueId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "targetTier" INTEGER NOT NULL,
  "finalPosition" INTEGER NOT NULL,
  "status" "PromotionOfferStatus" NOT NULL DEFAULT 'PENDING',
  "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "LeaguePromotionOffer_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LeagueNotice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "referenceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3),
  CONSTRAINT "LeagueNotice_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "FriendlyChallenge" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "creatorUserId" TEXT NOT NULL,
  "creatorClubId" TEXT NOT NULL,
  "status" "FriendlyChallengeStatus" NOT NULL DEFAULT 'OPEN',
  "matchId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FriendlyChallenge_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ChallengeDailyUsage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "usageDate" DATE NOT NULL,
  "freeUsed" INTEGER NOT NULL DEFAULT 0,
  "goldUsed" INTEGER NOT NULL DEFAULT 0,
  "purchasedCredits" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ChallengeDailyUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PyramidLeague_competitionId_key" ON "PyramidLeague"("competitionId");
CREATE UNIQUE INDEX "PyramidLeague_tier_season_groupNumber_key" ON "PyramidLeague"("tier", "season", "groupNumber");
CREATE INDEX "PyramidLeague_tier_season_idx" ON "PyramidLeague"("tier", "season");
CREATE UNIQUE INDEX "PyramidLeagueEntry_leagueId_clubId_key" ON "PyramidLeagueEntry"("leagueId", "clubId");
CREATE INDEX "PyramidLeagueEntry_clubId_joinedAt_idx" ON "PyramidLeagueEntry"("clubId", "joinedAt");
CREATE UNIQUE INDEX "PyramidLeagueApplication_clubId_tier_season_key" ON "PyramidLeagueApplication"("clubId", "tier", "season");
CREATE INDEX "PyramidLeagueApplication_tier_season_status_appliedAt_idx" ON "PyramidLeagueApplication"("tier", "season", "status", "appliedAt");
CREATE UNIQUE INDEX "LeaguePromotionOffer_leagueId_clubId_key" ON "LeaguePromotionOffer"("leagueId", "clubId");
CREATE INDEX "LeaguePromotionOffer_clubId_status_offeredAt_idx" ON "LeaguePromotionOffer"("clubId", "status", "offeredAt");
CREATE INDEX "LeagueNotice_userId_readAt_createdAt_idx" ON "LeagueNotice"("userId", "readAt", "createdAt");
CREATE UNIQUE INDEX "FriendlyChallenge_token_key" ON "FriendlyChallenge"("token");
CREATE UNIQUE INDEX "FriendlyChallenge_matchId_key" ON "FriendlyChallenge"("matchId");
CREATE INDEX "FriendlyChallenge_status_expiresAt_idx" ON "FriendlyChallenge"("status", "expiresAt");
CREATE INDEX "FriendlyChallenge_creatorClubId_createdAt_idx" ON "FriendlyChallenge"("creatorClubId", "createdAt");
CREATE UNIQUE INDEX "ChallengeDailyUsage_userId_usageDate_key" ON "ChallengeDailyUsage"("userId", "usageDate");

ALTER TABLE "PyramidLeague" ADD CONSTRAINT "PyramidLeague_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PyramidLeagueEntry" ADD CONSTRAINT "PyramidLeagueEntry_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "PyramidLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PyramidLeagueEntry" ADD CONSTRAINT "PyramidLeagueEntry_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PyramidLeagueApplication" ADD CONSTRAINT "PyramidLeagueApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PyramidLeagueApplication" ADD CONSTRAINT "PyramidLeagueApplication_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaguePromotionOffer" ADD CONSTRAINT "LeaguePromotionOffer_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "PyramidLeague"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaguePromotionOffer" ADD CONSTRAINT "LeaguePromotionOffer_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeagueNotice" ADD CONSTRAINT "LeagueNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FriendlyChallenge" ADD CONSTRAINT "FriendlyChallenge_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FriendlyChallenge" ADD CONSTRAINT "FriendlyChallenge_creatorClubId_fkey" FOREIGN KEY ("creatorClubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeDailyUsage" ADD CONSTRAINT "ChallengeDailyUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
