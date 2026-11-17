CREATE INDEX IF NOT EXISTS "EventTournament_status_competitionId_idx"
  ON "EventTournament" ("status", "competitionId");
