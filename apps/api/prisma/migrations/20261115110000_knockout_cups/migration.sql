ALTER TYPE "MatchType" ADD VALUE 'CUP';

CREATE TYPE "CompetitionFormat" AS ENUM ('LEAGUE', 'CUP');

ALTER TABLE "Competition"
  ADD COLUMN "format" "CompetitionFormat" NOT NULL DEFAULT 'LEAGUE';

ALTER TABLE "FootballMatch"
  ADD COLUMN "homePenalties" INTEGER,
  ADD COLUMN "awayPenalties" INTEGER,
  ADD COLUMN "winnerClubId" TEXT;

ALTER TABLE "FootballMatch"
  ADD CONSTRAINT "FootballMatch_penalty_scores_nonnegative"
  CHECK (("homePenalties" IS NULL OR "homePenalties" >= 0)
    AND ("awayPenalties" IS NULL OR "awayPenalties" >= 0));
