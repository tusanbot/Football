ALTER TABLE "EventTournament" ADD COLUMN "competitionId" TEXT;
CREATE UNIQUE INDEX "EventTournament_competitionId_key" ON "EventTournament"("competitionId");
ALTER TABLE "EventTournament"
ADD CONSTRAINT "EventTournament_competitionId_fkey"
FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
