ALTER TABLE "AcademyProspect" ADD COLUMN "scoutingBatchKey" TEXT;

CREATE INDEX "AcademyProspect_clubId_scoutingBatchKey_createdAt_idx"
ON "AcademyProspect"("clubId", "scoutingBatchKey", "createdAt");
