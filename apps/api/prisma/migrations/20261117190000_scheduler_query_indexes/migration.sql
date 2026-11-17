CREATE INDEX IF NOT EXISTS "EventTournament_status_competitionId_idx"
  ON "EventTournament" ("status", "competitionId");

CREATE INDEX IF NOT EXISTS "PyramidLeague_promotionProcessedAt_competitionId_idx"
  ON "PyramidLeague" ("promotionProcessedAt", "competitionId");

CREATE INDEX IF NOT EXISTS "LeaguePromotionOffer_status_expiresAt_idx"
  ON "LeaguePromotionOffer" ("status", "expiresAt");
