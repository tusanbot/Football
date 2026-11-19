ALTER TYPE "GroupPointSource" ADD VALUE IF NOT EXISTS 'GIFT_CODE';

ALTER TABLE "GiftCodeRedemption"
  ADD COLUMN "groupId" TEXT;

CREATE INDEX "GiftCodeRedemption_groupId_redeemedAt_idx"
  ON "GiftCodeRedemption"("groupId", "redeemedAt");

ALTER TABLE "GiftCodeRedemption"
  ADD CONSTRAINT "GiftCodeRedemption_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
