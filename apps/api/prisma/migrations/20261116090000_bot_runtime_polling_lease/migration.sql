CREATE TABLE "BotRuntimeLease" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BotRuntimeLease_pkey" PRIMARY KEY ("id")
);
