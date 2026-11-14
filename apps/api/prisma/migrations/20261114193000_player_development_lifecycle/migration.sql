ALTER TYPE "PlayerStatus" ADD VALUE 'CONTRACT_EXPIRED';

CREATE TYPE "TrainingFocus" AS ENUM ('BALANCED', 'GOALKEEPING', 'DEFENDING', 'PASSING', 'PLAYMAKING', 'DRIBBLING', 'SHOOTING', 'PHYSICAL');
CREATE TYPE "TrainingIntensity" AS ENUM ('LIGHT', 'NORMAL', 'INTENSE');

ALTER TABLE "Club"
  ADD COLUMN "trainingGroundLevel" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lastDailyTickAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Player"
  ADD COLUMN "ageDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "trainingFocus" "TrainingFocus" NOT NULL DEFAULT 'BALANCED',
  ADD COLUMN "injuryUntil" TIMESTAMP(3),
  ADD COLUMN "lastTrainedAt" TIMESTAMP(3);

CREATE TABLE "Coach" (
  "id" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "level" INTEGER NOT NULL DEFAULT 1,
  "trainingSkill" INTEGER NOT NULL DEFAULT 35,
  "recoverySkill" INTEGER NOT NULL DEFAULT 30,
  "medicalSkill" INTEGER NOT NULL DEFAULT 25,
  "weeklySalary" BIGINT NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Coach_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClubDailyTick" (
  "id" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "gameDate" DATE NOT NULL,
  "elapsedDays" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubDailyTick_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerTrainingLog" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "trainingDate" DATE NOT NULL,
  "focus" "TrainingFocus" NOT NULL,
  "intensity" "TrainingIntensity" NOT NULL,
  "cashCost" BIGINT NOT NULL,
  "overallBefore" INTEGER NOT NULL,
  "overallAfter" INTEGER NOT NULL,
  "fitnessBefore" INTEGER NOT NULL,
  "fitnessAfter" INTEGER NOT NULL,
  "attributesBefore" JSONB NOT NULL,
  "attributesAfter" JSONB NOT NULL,
  "injuryOccurred" BOOLEAN NOT NULL DEFAULT false,
  "injuryUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerTrainingLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerContractRenewal" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "extensionDays" INTEGER NOT NULL,
  "oldContractDays" INTEGER NOT NULL,
  "newContractDays" INTEGER NOT NULL,
  "oldWage" BIGINT NOT NULL,
  "newWage" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerContractRenewal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Coach_clubId_key" ON "Coach"("clubId");
CREATE UNIQUE INDEX "ClubDailyTick_clubId_gameDate_key" ON "ClubDailyTick"("clubId", "gameDate");
CREATE INDEX "ClubDailyTick_gameDate_idx" ON "ClubDailyTick"("gameDate");
CREATE UNIQUE INDEX "PlayerTrainingLog_idempotencyKey_key" ON "PlayerTrainingLog"("idempotencyKey");
CREATE UNIQUE INDEX "PlayerTrainingLog_playerId_trainingDate_key" ON "PlayerTrainingLog"("playerId", "trainingDate");
CREATE INDEX "PlayerTrainingLog_clubId_trainingDate_idx" ON "PlayerTrainingLog"("clubId", "trainingDate");
CREATE INDEX "PlayerTrainingLog_userId_createdAt_idx" ON "PlayerTrainingLog"("userId", "createdAt");
CREATE UNIQUE INDEX "PlayerContractRenewal_idempotencyKey_key" ON "PlayerContractRenewal"("idempotencyKey");
CREATE INDEX "PlayerContractRenewal_clubId_createdAt_idx" ON "PlayerContractRenewal"("clubId", "createdAt");
CREATE INDEX "PlayerContractRenewal_playerId_createdAt_idx" ON "PlayerContractRenewal"("playerId", "createdAt");

ALTER TABLE "Coach" ADD CONSTRAINT "Coach_clubId_fkey"
  FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubDailyTick" ADD CONSTRAINT "ClubDailyTick_clubId_fkey"
  FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerTrainingLog" ADD CONSTRAINT "PlayerTrainingLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayerTrainingLog" ADD CONSTRAINT "PlayerTrainingLog_clubId_fkey"
  FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayerTrainingLog" ADD CONSTRAINT "PlayerTrainingLog_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayerContractRenewal" ADD CONSTRAINT "PlayerContractRenewal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayerContractRenewal" ADD CONSTRAINT "PlayerContractRenewal_clubId_fkey"
  FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlayerContractRenewal" ADD CONSTRAINT "PlayerContractRenewal_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
