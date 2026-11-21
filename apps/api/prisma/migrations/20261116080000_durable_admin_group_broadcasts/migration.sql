CREATE TABLE "AdminGroupBroadcast" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdByTelegramId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminGroupBroadcast_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminGroupBroadcast_idempotencyKey_key" ON "AdminGroupBroadcast"("idempotencyKey");
CREATE TABLE "AdminGroupBroadcastDelivery" (
  "id" TEXT NOT NULL,
  "broadcastId" TEXT NOT NULL,
  "telegramGroupId" TEXT NOT NULL,
  "groupTitle" TEXT NOT NULL,
  "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveryClaimToken" TEXT,
  "deliveryLockedUntil" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "deliveryLastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminGroupBroadcastDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminGroupBroadcastDelivery_broadcastId_telegramGroupId_key" ON "AdminGroupBroadcastDelivery"("broadcastId", "telegramGroupId");
CREATE INDEX "AdminGroupBroadcastDelivery_deliveredAt_availableAt_deliveryLockedUntil_idx" ON "AdminGroupBroadcastDelivery"("deliveredAt", "availableAt", "deliveryLockedUntil");
ALTER TABLE "AdminGroupBroadcastDelivery" ADD CONSTRAINT "AdminGroupBroadcastDelivery_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "AdminGroupBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;
