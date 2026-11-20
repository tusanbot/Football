ALTER TYPE "MatchStatus" ADD VALUE 'IN_PROGRESS';
CREATE TYPE "MatchRuntimeStatus" AS ENUM ('QUEUED', 'RUNNING', 'AWAITING_CHECKPOINT', 'COMPLETED', 'FAILED');
CREATE TYPE "MatchCheckpointKind" AS ENUM ('HALF_TIME', 'MINUTE_60', 'MINUTE_75');
CREATE TYPE "MatchCheckpointStatus" AS ENUM ('OPEN', 'RESOLVED', 'EXPIRED');
CREATE TABLE "MatchRuntime" (
"id" TEXT NOT NULL,"matchId" TEXT NOT NULL,"status" "MatchRuntimeStatus" NOT NULL DEFAULT 'QUEUED',
"currentMinute" INTEGER NOT NULL DEFAULT 0,"stateVersion" INTEGER NOT NULL DEFAULT 1,"nextActionAt" TIMESTAMP(3),
"kickoffSnapshot" JSONB,"simulationState" JSONB,"fallbackPlan" JSONB,"leaseOwner" TEXT,"leaseToken" TEXT,
"leaseExpiresAt" TIMESTAMP(3),"lastError" TEXT,"startedAt" TIMESTAMP(3),"completedAt" TIMESTAMP(3),
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
CONSTRAINT "MatchRuntime_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "MatchRuntime_matchId_key" ON "MatchRuntime"("matchId");
CREATE INDEX "MatchRuntime_status_nextActionAt_idx" ON "MatchRuntime"("status","nextActionAt");
CREATE INDEX "MatchRuntime_leaseExpiresAt_idx" ON "MatchRuntime"("leaseExpiresAt");
ALTER TABLE "MatchRuntime" ADD CONSTRAINT "MatchRuntime_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "FootballMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "MatchTacticalCheckpoint" (
"id" TEXT NOT NULL,"matchId" TEXT NOT NULL,"checkpointKey" TEXT NOT NULL,"kind" "MatchCheckpointKind" NOT NULL,
"minute" INTEGER NOT NULL,"status" "MatchCheckpointStatus" NOT NULL DEFAULT 'OPEN',"openedAt" TIMESTAMP(3) NOT NULL,
"decisionDeadlineAt" TIMESTAMP(3) NOT NULL,"nextSegmentAt" TIMESTAMP(3) NOT NULL,"resolvedAt" TIMESTAMP(3),
"resolution" JSONB,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
CONSTRAINT "MatchTacticalCheckpoint_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "MatchTacticalCheckpoint_matchId_checkpointKey_key" ON "MatchTacticalCheckpoint"("matchId","checkpointKey");
CREATE INDEX "MatchTacticalCheckpoint_status_nextSegmentAt_idx" ON "MatchTacticalCheckpoint"("status","nextSegmentAt");
CREATE INDEX "MatchTacticalCheckpoint_matchId_minute_idx" ON "MatchTacticalCheckpoint"("matchId","minute");
ALTER TABLE "MatchTacticalCheckpoint" ADD CONSTRAINT "MatchTacticalCheckpoint_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "FootballMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "MatchTacticalDecision" (
"id" TEXT NOT NULL,"idempotencyKey" TEXT NOT NULL,"checkpointId" TEXT NOT NULL,"clubId" TEXT NOT NULL,
"submittedByUserId" TEXT NOT NULL,"instruction" JSONB NOT NULL,"submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "MatchTacticalDecision_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "MatchTacticalDecision_idempotencyKey_key" ON "MatchTacticalDecision"("idempotencyKey");
CREATE INDEX "MatchTacticalDecision_checkpointId_clubId_submittedAt_idx" ON "MatchTacticalDecision"("checkpointId","clubId","submittedAt");
CREATE INDEX "MatchTacticalDecision_clubId_submittedAt_idx" ON "MatchTacticalDecision"("clubId","submittedAt");
ALTER TABLE "MatchTacticalDecision" ADD CONSTRAINT "MatchTacticalDecision_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "MatchTacticalCheckpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchTacticalDecision" ADD CONSTRAINT "MatchTacticalDecision_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
