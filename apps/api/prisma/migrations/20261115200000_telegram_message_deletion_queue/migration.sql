CREATE TYPE "TelegramMessageDeletionStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELETED', 'FAILED');

CREATE TABLE "TelegramMessageDeletion" (
  "id" TEXT NOT NULL,
  "telegramChatId" BIGINT NOT NULL,
  "messageId" INTEGER NOT NULL,
  "deleteAt" TIMESTAMP(3) NOT NULL,
  "availableAt" TIMESTAMP(3) NOT NULL,
  "status" "TelegramMessageDeletionStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "claimToken" TEXT,
  "lastError" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramMessageDeletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramMessageDeletion_telegramChatId_messageId_key"
  ON "TelegramMessageDeletion"("telegramChatId", "messageId");
CREATE INDEX "TelegramMessageDeletion_status_deleteAt_availableAt_idx"
  ON "TelegramMessageDeletion"("status", "deleteAt", "availableAt");
CREATE INDEX "TelegramMessageDeletion_status_lockedUntil_idx"
  ON "TelegramMessageDeletion"("status", "lockedUntil");
