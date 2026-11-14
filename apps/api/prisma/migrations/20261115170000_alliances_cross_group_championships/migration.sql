CREATE TYPE "AllianceStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISSOLVED');

ALTER TABLE "TelegramGroup"
  ADD COLUMN "createdAlliances_placeholder" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "Competition"
  ADD COLUMN "allianceId" TEXT,
  ADD COLUMN "allianceSeasonId" TEXT;

CREATE TABLE "Alliance" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "status" "AllianceStatus" NOT NULL DEFAULT 'ACTIVE',
  "treasuryPoints" BIGINT NOT NULL DEFAULT 0,
  "createdByGroupId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Alliance_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AllianceGroup" (
  "id" TEXT NOT NULL,
  "allianceId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'MEMBER',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AllianceGroup_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AllianceInvitation" (
  "id" TEXT NOT NULL,
  "allianceId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "invitedByGroupId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "AllianceInvitation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AllianceSeason" (
  "id" TEXT NOT NULL,
  "allianceId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "standings" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AllianceSeason_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AllianceLedger" (
  "id" TEXT NOT NULL,
  "allianceId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "amount" BIGINT NOT NULL,
  "source" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AllianceLedger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Alliance_slug_key" ON "Alliance"("slug");
CREATE INDEX "Alliance_status_createdAt_idx" ON "Alliance"("status","createdAt");
CREATE UNIQUE INDEX "AllianceGroup_groupId_key" ON "AllianceGroup"("groupId");
CREATE UNIQUE INDEX "AllianceGroup_allianceId_groupId_key" ON "AllianceGroup"("allianceId","groupId");
CREATE INDEX "AllianceGroup_allianceId_joinedAt_idx" ON "AllianceGroup"("allianceId","joinedAt");
CREATE UNIQUE INDEX "AllianceInvitation_allianceId_groupId_key" ON "AllianceInvitation"("allianceId","groupId");
CREATE INDEX "AllianceInvitation_groupId_status_idx" ON "AllianceInvitation"("groupId","status");
CREATE UNIQUE INDEX "AllianceSeason_allianceId_number_key" ON "AllianceSeason"("allianceId","number");
CREATE INDEX "AllianceSeason_allianceId_status_endsAt_idx" ON "AllianceSeason"("allianceId","status","endsAt");
CREATE UNIQUE INDEX "AllianceLedger_idempotencyKey_key" ON "AllianceLedger"("idempotencyKey");
CREATE INDEX "AllianceLedger_allianceId_createdAt_idx" ON "AllianceLedger"("allianceId","createdAt");
CREATE INDEX "Competition_allianceId_idx" ON "Competition"("allianceId");
ALTER TABLE "Alliance" ADD CONSTRAINT "Alliance_createdByGroupId_fkey" FOREIGN KEY ("createdByGroupId") REFERENCES "TelegramGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AllianceGroup" ADD CONSTRAINT "AllianceGroup_allianceId_fkey" FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AllianceGroup" ADD CONSTRAINT "AllianceGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AllianceInvitation" ADD CONSTRAINT "AllianceInvitation_allianceId_fkey" FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AllianceInvitation" ADD CONSTRAINT "AllianceInvitation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Competition" ADD CONSTRAINT "Competition_allianceId_fkey" FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
