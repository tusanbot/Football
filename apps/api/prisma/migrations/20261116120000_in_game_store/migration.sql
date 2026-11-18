CREATE TABLE "StoreInventoryItem" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemKey" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoreInventoryItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StoreInventoryItem_userId_itemKey_key" ON "StoreInventoryItem"("userId", "itemKey");
CREATE INDEX "StoreInventoryItem_userId_updatedAt_idx" ON "StoreInventoryItem"("userId", "updatedAt");
ALTER TABLE "StoreInventoryItem" ADD CONSTRAINT "StoreInventoryItem_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StorePurchase" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemKey" TEXT NOT NULL,
  "asset" "WalletAsset" NOT NULL,
  "amount" BIGINT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StorePurchase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StorePurchase_idempotencyKey_key" ON "StorePurchase"("idempotencyKey");
CREATE INDEX "StorePurchase_userId_createdAt_idx" ON "StorePurchase"("userId", "createdAt");
ALTER TABLE "StorePurchase" ADD CONSTRAINT "StorePurchase_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "StoreItemUse" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemKey" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoreItemUse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StoreItemUse_idempotencyKey_key" ON "StoreItemUse"("idempotencyKey");
CREATE INDEX "StoreItemUse_userId_createdAt_idx" ON "StoreItemUse"("userId", "createdAt");
CREATE INDEX "StoreItemUse_playerId_createdAt_idx" ON "StoreItemUse"("playerId", "createdAt");
ALTER TABLE "StoreItemUse" ADD CONSTRAINT "StoreItemUse_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoreItemUse" ADD CONSTRAINT "StoreItemUse_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
