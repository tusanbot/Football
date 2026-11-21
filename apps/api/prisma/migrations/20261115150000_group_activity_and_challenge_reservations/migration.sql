ALTER TYPE "GroupPointSource" ADD VALUE IF NOT EXISTS 'GAME_ACTIVITY';
ALTER TABLE "GroupChallenge" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "GroupChallenge_idempotencyKey_key" ON "GroupChallenge"("idempotencyKey");
