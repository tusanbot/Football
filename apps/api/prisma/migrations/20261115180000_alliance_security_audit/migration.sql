CREATE TYPE "AllianceSeasonReviewStatus" AS ENUM ('PENDING', 'FLAGGED', 'APPROVED', 'REJECTED');

ALTER TABLE "AllianceSeason"
  ADD COLUMN "reviewStatus" "AllianceSeasonReviewStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "securityFlags" JSONB,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedByUserId" TEXT;

CREATE TABLE "AllianceAuditLog" (
  "id" TEXT NOT NULL,
  "allianceId" TEXT NOT NULL,
  "actorTelegramId" TEXT NOT NULL,
  "groupTelegramId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AllianceAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AllianceAuditLog_allianceId_createdAt_idx" ON "AllianceAuditLog"("allianceId", "createdAt");
CREATE INDEX "AllianceAuditLog_actorTelegramId_createdAt_idx" ON "AllianceAuditLog"("actorTelegramId", "createdAt");

ALTER TABLE "AllianceAuditLog"
  ADD CONSTRAINT "AllianceAuditLog_allianceId_fkey"
  FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
