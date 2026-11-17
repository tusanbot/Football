ALTER TABLE "Competition" ADD COLUMN "cupLegs" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "FootballMatch" ADD COLUMN "tieId" TEXT;
ALTER TABLE "FootballMatch" ADD COLUMN "leg" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "FootballMatch_competitionId_round_tieId_idx" ON "FootballMatch"("competitionId", "round", "tieId");
