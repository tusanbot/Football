CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "MatchType" AS ENUM ('FRIENDLY', 'LEAGUE');
CREATE TYPE "MatchEventType" AS ENUM ('GOAL', 'YELLOW_CARD', 'RED_CARD', 'INJURY');
CREATE TYPE "CompetitionStatus" AS ENUM ('DRAFT', 'REGISTRATION', 'ACTIVE', 'COMPLETED', 'CANCELLED');

CREATE TABLE "Competition" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "season" INTEGER NOT NULL,
  "status" "CompetitionStatus" NOT NULL DEFAULT 'REGISTRATION',
  "maxTeams" INTEGER NOT NULL DEFAULT 8,
  "createdByClubId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Competition_idempotencyKey_key" ON "Competition"("idempotencyKey");
CREATE INDEX "Competition_status_createdAt_idx" ON "Competition"("status", "createdAt");

CREATE TABLE "CompetitionEntry" (
  "id" TEXT NOT NULL,
  "competitionId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "played" INTEGER NOT NULL DEFAULT 0,
  "won" INTEGER NOT NULL DEFAULT 0,
  "drawn" INTEGER NOT NULL DEFAULT 0,
  "lost" INTEGER NOT NULL DEFAULT 0,
  "goalsFor" INTEGER NOT NULL DEFAULT 0,
  "goalsAgainst" INTEGER NOT NULL DEFAULT 0,
  "points" INTEGER NOT NULL DEFAULT 0,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompetitionEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CompetitionEntry_competitionId_clubId_key" ON "CompetitionEntry"("competitionId", "clubId");
CREATE INDEX "CompetitionEntry_competitionId_points_goalsFor_idx" ON "CompetitionEntry"("competitionId", "points", "goalsFor");

CREATE TABLE "FootballMatch" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "type" "MatchType" NOT NULL DEFAULT 'FRIENDLY',
  "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
  "homeClubId" TEXT NOT NULL,
  "awayClubId" TEXT NOT NULL,
  "competitionId" TEXT,
  "round" INTEGER,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "seed" TEXT NOT NULL,
  "simulationVersion" INTEGER NOT NULL DEFAULT 1,
  "homeScore" INTEGER,
  "awayScore" INTEGER,
  "attendance" INTEGER NOT NULL DEFAULT 0,
  "ticketRevenue" BIGINT NOT NULL DEFAULT 0,
  "homeExpectedGoals" DOUBLE PRECISION,
  "awayExpectedGoals" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FootballMatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FootballMatch_idempotencyKey_key" ON "FootballMatch"("idempotencyKey");
CREATE INDEX "FootballMatch_homeClubId_scheduledAt_status_idx" ON "FootballMatch"("homeClubId", "scheduledAt", "status");
CREATE INDEX "FootballMatch_awayClubId_scheduledAt_status_idx" ON "FootballMatch"("awayClubId", "scheduledAt", "status");
CREATE INDEX "FootballMatch_competitionId_round_idx" ON "FootballMatch"("competitionId", "round");
CREATE INDEX "FootballMatch_status_scheduledAt_idx" ON "FootballMatch"("status", "scheduledAt");

CREATE TABLE "MatchEvent" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "minute" INTEGER NOT NULL,
  "type" "MatchEventType" NOT NULL,
  "teamId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "relatedPlayerId" TEXT,
  "detail" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MatchEvent_matchId_sequence_key" ON "MatchEvent"("matchId", "sequence");
CREATE INDEX "MatchEvent_matchId_minute_idx" ON "MatchEvent"("matchId", "minute");

CREATE TABLE "PlayerMatchPerformance" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "minutesPlayed" INTEGER NOT NULL DEFAULT 90,
  "goals" INTEGER NOT NULL DEFAULT 0,
  "assists" INTEGER NOT NULL DEFAULT 0,
  "shots" INTEGER NOT NULL DEFAULT 0,
  "passes" INTEGER NOT NULL DEFAULT 0,
  "tackles" INTEGER NOT NULL DEFAULT 0,
  "yellowCards" INTEGER NOT NULL DEFAULT 0,
  "redCards" INTEGER NOT NULL DEFAULT 0,
  "rating" DOUBLE PRECISION NOT NULL,
  "fitnessLoss" INTEGER NOT NULL,
  CONSTRAINT "PlayerMatchPerformance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlayerMatchPerformance_matchId_playerId_key" ON "PlayerMatchPerformance"("matchId", "playerId");
CREATE INDEX "PlayerMatchPerformance_clubId_matchId_idx" ON "PlayerMatchPerformance"("clubId", "matchId");
CREATE INDEX "PlayerMatchPerformance_playerId_matchId_idx" ON "PlayerMatchPerformance"("playerId", "matchId");

ALTER TABLE "CompetitionEntry" ADD CONSTRAINT "CompetitionEntry_competitionId_fkey"
  FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompetitionEntry" ADD CONSTRAINT "CompetitionEntry_clubId_fkey"
  FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FootballMatch" ADD CONSTRAINT "FootballMatch_homeClubId_fkey"
  FOREIGN KEY ("homeClubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FootballMatch" ADD CONSTRAINT "FootballMatch_awayClubId_fkey"
  FOREIGN KEY ("awayClubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FootballMatch" ADD CONSTRAINT "FootballMatch_competitionId_fkey"
  FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "FootballMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerMatchPerformance" ADD CONSTRAINT "PlayerMatchPerformance_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "FootballMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerMatchPerformance" ADD CONSTRAINT "PlayerMatchPerformance_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayerMatchPerformance" ADD CONSTRAINT "PlayerMatchPerformance_clubId_fkey"
  FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
