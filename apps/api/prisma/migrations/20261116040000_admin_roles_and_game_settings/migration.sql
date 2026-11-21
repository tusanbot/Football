CREATE TABLE "AdminRoleAssignment" (
  "id" TEXT NOT NULL,
  "telegramId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByTelegramId" TEXT NOT NULL,
  "updatedByTelegramId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminRoleAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminRoleAssignment_telegramId_key" ON "AdminRoleAssignment"("telegramId");
CREATE INDEX "AdminRoleAssignment_role_active_idx" ON "AdminRoleAssignment"("role", "active");

CREATE TABLE "GameSetting" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "description" TEXT,
  "updatedByTelegramId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GameSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GameSetting_key_key" ON "GameSetting"("key");
CREATE INDEX "GameSetting_updatedAt_idx" ON "GameSetting"("updatedAt");
