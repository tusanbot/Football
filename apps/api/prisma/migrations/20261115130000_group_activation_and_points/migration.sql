ALTER TABLE "TelegramGroup"
  ADD COLUMN "memberCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "points" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "lastMemberCountCheckAt" TIMESTAMP(3);

ALTER TABLE "Competition" ADD COLUMN "groupId" TEXT;
CREATE INDEX "Competition_groupId_status_idx" ON "Competition"("groupId", "status");
ALTER TABLE "Competition" ADD CONSTRAINT "Competition_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "GroupPointSource" AS ENUM ('DAILY_ACTIVITY', 'CHALLENGE_REWARD', 'LEAGUE_REWARD', 'ADMIN_ADJUSTMENT');

CREATE TABLE "GroupPointLedger" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "userId" TEXT,
  "amount" BIGINT NOT NULL,
  "source" "GroupPointSource" NOT NULL,
  "description" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupPointLedger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GroupPointLedger_idempotencyKey_key" ON "GroupPointLedger"("idempotencyKey");
CREATE INDEX "GroupPointLedger_groupId_createdAt_idx" ON "GroupPointLedger"("groupId", "createdAt");
CREATE INDEX "GroupPointLedger_userId_createdAt_idx" ON "GroupPointLedger"("userId", "createdAt");
ALTER TABLE "GroupPointLedger" ADD CONSTRAINT "GroupPointLedger_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupPointLedger" ADD CONSTRAINT "GroupPointLedger_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "GroupRewardItem" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "cost" BIGINT NOT NULL,
  "scope" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupRewardItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GroupRewardItem_slug_key" ON "GroupRewardItem"("slug");

CREATE TABLE "GroupRewardGrant" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "grantedByUserId" TEXT NOT NULL,
  "recipientUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupRewardGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GroupRewardGrant_idempotencyKey_key" ON "GroupRewardGrant"("idempotencyKey");
CREATE INDEX "GroupRewardGrant_groupId_createdAt_idx" ON "GroupRewardGrant"("groupId", "createdAt");
CREATE INDEX "GroupRewardGrant_recipientUserId_createdAt_idx" ON "GroupRewardGrant"("recipientUserId", "createdAt");
ALTER TABLE "GroupRewardGrant" ADD CONSTRAINT "GroupRewardGrant_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupRewardGrant" ADD CONSTRAINT "GroupRewardGrant_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "GroupRewardItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
