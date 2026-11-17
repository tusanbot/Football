CREATE TYPE "EventTournamentStatus" AS ENUM ('REGISTRATION', 'ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "EventTournamentPrizeType" AS ENUM ('CASH', 'GOLD', 'HONOR', 'STORE_ITEM', 'SPECIAL_PLAYER');

CREATE TABLE "EventTournament" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "EventTournamentStatus" NOT NULL DEFAULT 'REGISTRATION',
  "entryFeeAsset" "WalletAsset",
  "entryFeeAmount" BIGINT NOT NULL DEFAULT 0,
  "maxParticipants" INTEGER NOT NULL DEFAULT 128,
  "registrationEndsAt" TIMESTAMP(3) NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3),
  "createdByTelegramId" TEXT NOT NULL,
  "finalizedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventTournament_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventTournamentParticipant" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "placement" INTEGER,
  "score" INTEGER NOT NULL DEFAULT 0,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "prizeSettledAt" TIMESTAMP(3),
  CONSTRAINT "EventTournamentParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventTournamentPrize" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "placement" INTEGER NOT NULL,
  "type" "EventTournamentPrizeType" NOT NULL,
  "amount" BIGINT NOT NULL DEFAULT 0,
  "itemKey" TEXT,
  "specialPlayerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventTournamentPrize_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventTournamentPrizeAward" (
  "id" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "prizeId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'AWARDED',
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventTournamentPrizeAward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventTournament_idempotencyKey_key" ON "EventTournament"("idempotencyKey");
CREATE INDEX "EventTournament_status_registrationEndsAt_startsAt_idx" ON "EventTournament"("status", "registrationEndsAt", "startsAt");
CREATE INDEX "EventTournament_createdAt_idx" ON "EventTournament"("createdAt");
CREATE UNIQUE INDEX "EventTournamentParticipant_tournamentId_userId_key" ON "EventTournamentParticipant"("tournamentId", "userId");
CREATE UNIQUE INDEX "EventTournamentParticipant_tournamentId_clubId_key" ON "EventTournamentParticipant"("tournamentId", "clubId");
CREATE INDEX "EventTournamentParticipant_tournamentId_placement_score_idx" ON "EventTournamentParticipant"("tournamentId", "placement", "score");
CREATE INDEX "EventTournamentParticipant_userId_joinedAt_idx" ON "EventTournamentParticipant"("userId", "joinedAt");
CREATE INDEX "EventTournamentPrize_tournamentId_placement_idx" ON "EventTournamentPrize"("tournamentId", "placement");
CREATE UNIQUE INDEX "EventTournamentPrizeAward_participantId_prizeId_key" ON "EventTournamentPrizeAward"("participantId", "prizeId");
CREATE INDEX "EventTournamentPrizeAward_createdAt_idx" ON "EventTournamentPrizeAward"("createdAt");

ALTER TABLE "EventTournamentParticipant" ADD CONSTRAINT "EventTournamentParticipant_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "EventTournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventTournamentParticipant" ADD CONSTRAINT "EventTournamentParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventTournamentParticipant" ADD CONSTRAINT "EventTournamentParticipant_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventTournamentPrize" ADD CONSTRAINT "EventTournamentPrize_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "EventTournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventTournamentPrize" ADD CONSTRAINT "EventTournamentPrize_specialPlayerId_fkey" FOREIGN KEY ("specialPlayerId") REFERENCES "SpecialPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventTournamentPrizeAward" ADD CONSTRAINT "EventTournamentPrizeAward_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "EventTournamentParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventTournamentPrizeAward" ADD CONSTRAINT "EventTournamentPrizeAward_prizeId_fkey" FOREIGN KEY ("prizeId") REFERENCES "EventTournamentPrize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- New public tables must follow the repository's server-only data-access policy.
ALTER TABLE "EventTournament" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventTournamentParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventTournamentPrize" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventTournamentPrizeAward" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "EventTournament", "EventTournamentParticipant", "EventTournamentPrize", "EventTournamentPrizeAward" FROM PUBLIC;
