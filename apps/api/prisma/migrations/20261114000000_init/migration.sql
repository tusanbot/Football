CREATE TYPE "WalletAsset" AS ENUM ('CASH', 'GOLD');
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "GroupRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "ChallengeStatus" AS ENUM ('DRAFT', 'OPEN', 'RUNNING', 'COMPLETED', 'CANCELLED');
CREATE TYPE "PlayerOrigin" AS ENUM ('GENERATED', 'SPECIAL');
CREATE TYPE "PlayerPosition" AS ENUM ('GK', 'RB', 'LB', 'CB', 'CDM', 'CM', 'CAM', 'RW', 'LW', 'ST');
CREATE TYPE "PlayerStatus" AS ENUM ('ACTIVE', 'LISTED', 'INJURED', 'RETIRED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "telegramId" TEXT NOT NULL,
  "username" TEXT,
  "displayName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Club" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "level" INTEGER NOT NULL DEFAULT 1,
  "reputation" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SpecialPlayer" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "nationality" VARCHAR(2) NOT NULL,
  "birthDate" TIMESTAMP(3),
  "positions" TEXT[] NOT NULL,
  "overall" INTEGER NOT NULL,
  "potential" INTEGER NOT NULL,
  "attributes" JSONB NOT NULL,
  "sourceNote" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SpecialPlayer_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Player" (
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
  "wage" BIGINT NOT NULL,
  "contractDays" INTEGER NOT NULL,
  "morale" INTEGER NOT NULL DEFAULT 75,
  "fitness" INTEGER NOT NULL DEFAULT 100,
  "origin" "PlayerOrigin" NOT NULL DEFAULT 'GENERATED',
  "status" "PlayerStatus" NOT NULL DEFAULT 'ACTIVE',
  "specialPlayerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Wallet" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "asset" "WalletAsset" NOT NULL,
  "balance" BIGINT NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LedgerTransaction" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "asset" "WalletAsset" NOT NULL,
  "direction" "LedgerDirection" NOT NULL,
  "amount" BIGINT NOT NULL,
  "reason" TEXT NOT NULL,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TelegramGroup" (
  "id" TEXT NOT NULL,
  "telegramId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramGroup_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "GroupMembership" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "GroupRole" NOT NULL DEFAULT 'MEMBER',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupMembership_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "GroupChallenge" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "ChallengeStatus" NOT NULL DEFAULT 'DRAFT',
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
CREATE UNIQUE INDEX "Club_ownerId_key" ON "Club"("ownerId");
CREATE UNIQUE INDEX "Club_slug_key" ON "Club"("slug");
CREATE UNIQUE INDEX "SpecialPlayer_slug_key" ON "SpecialPlayer"("slug");
CREATE UNIQUE INDEX "Player_specialPlayerId_key" ON "Player"("specialPlayerId");
CREATE INDEX "Player_clubId_status_idx" ON "Player"("clubId", "status");
CREATE INDEX "Player_clubId_position_idx" ON "Player"("clubId", "position");
CREATE INDEX "Player_nationality_idx" ON "Player"("nationality");
CREATE UNIQUE INDEX "Wallet_userId_asset_key" ON "Wallet"("userId", "asset");
CREATE UNIQUE INDEX "LedgerTransaction_idempotencyKey_key" ON "LedgerTransaction"("idempotencyKey");
CREATE INDEX "LedgerTransaction_userId_createdAt_idx" ON "LedgerTransaction"("userId", "createdAt");
CREATE INDEX "LedgerTransaction_referenceType_referenceId_idx" ON "LedgerTransaction"("referenceType", "referenceId");
CREATE UNIQUE INDEX "TelegramGroup_telegramId_key" ON "TelegramGroup"("telegramId");
CREATE UNIQUE INDEX "GroupMembership_groupId_userId_key" ON "GroupMembership"("groupId", "userId");
CREATE INDEX "GroupChallenge_groupId_status_idx" ON "GroupChallenge"("groupId", "status");

ALTER TABLE "Club" ADD CONSTRAINT "Club_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Player" ADD CONSTRAINT "Player_clubId_fkey"
  FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Player" ADD CONSTRAINT "Player_specialPlayerId_fkey"
  FOREIGN KEY ("specialPlayerId") REFERENCES "SpecialPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupChallenge" ADD CONSTRAINT "GroupChallenge_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
