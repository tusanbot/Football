ALTER TABLE "Club"
  ADD COLUMN "stadiumLevel" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "academyLevel" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastEconomyTickAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "operatingArrears" BIGINT NOT NULL DEFAULT 0;

CREATE TYPE "AcademyProspectStatus" AS ENUM ('AVAILABLE', 'RECRUITED', 'RELEASED');

CREATE TABLE "SponsorContract" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "partnerName" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "dailyIncome" BIGINT NOT NULL,
  "signingBonus" BIGINT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SponsorContract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcademyProspect" (
  "id" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "nationality" VARCHAR(2) NOT NULL,
  "age" INTEGER NOT NULL,
  "position" "PlayerPosition" NOT NULL,
  "overall" INTEGER NOT NULL,
  "potential" INTEGER NOT NULL,
  "attributes" JSONB NOT NULL,
  "recruitmentCost" BIGINT NOT NULL,
  "status" "AcademyProspectStatus" NOT NULL DEFAULT 'AVAILABLE',
  "recruitedPlayerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recruitedAt" TIMESTAMP(3),
  CONSTRAINT "AcademyProspect_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClubFinanceEntry" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "direction" "LedgerDirection" NOT NULL,
  "amount" BIGINT NOT NULL,
  "description" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubFinanceEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClubEconomyTick" (
  "id" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "gameDate" DATE NOT NULL,
  "elapsedDays" INTEGER NOT NULL,
  "income" BIGINT NOT NULL,
  "expenses" BIGINT NOT NULL,
  "paid" BIGINT NOT NULL,
  "arrears" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubEconomyTick_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SponsorContract_idempotencyKey_key" ON "SponsorContract"("idempotencyKey");
CREATE INDEX "SponsorContract_clubId_status_endsAt_idx" ON "SponsorContract"("clubId", "status", "endsAt");
CREATE UNIQUE INDEX "AcademyProspect_recruitedPlayerId_key" ON "AcademyProspect"("recruitedPlayerId");
CREATE INDEX "AcademyProspect_clubId_status_createdAt_idx" ON "AcademyProspect"("clubId", "status", "createdAt");
CREATE UNIQUE INDEX "ClubFinanceEntry_idempotencyKey_key" ON "ClubFinanceEntry"("idempotencyKey");
CREATE INDEX "ClubFinanceEntry_clubId_occurredAt_idx" ON "ClubFinanceEntry"("clubId", "occurredAt");
CREATE INDEX "ClubFinanceEntry_clubId_category_occurredAt_idx" ON "ClubFinanceEntry"("clubId", "category", "occurredAt");
CREATE UNIQUE INDEX "ClubEconomyTick_clubId_gameDate_key" ON "ClubEconomyTick"("clubId", "gameDate");
CREATE INDEX "ClubEconomyTick_gameDate_idx" ON "ClubEconomyTick"("gameDate");

ALTER TABLE "SponsorContract" ADD CONSTRAINT "SponsorContract_clubId_fkey"
  FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademyProspect" ADD CONSTRAINT "AcademyProspect_clubId_fkey"
  FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubFinanceEntry" ADD CONSTRAINT "ClubFinanceEntry_clubId_fkey"
  FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubEconomyTick" ADD CONSTRAINT "ClubEconomyTick_clubId_fkey"
  FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
