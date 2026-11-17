ALTER TABLE "LeagueNotice" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "LeagueNotice_dedupeKey_key" ON "LeagueNotice"("dedupeKey");
