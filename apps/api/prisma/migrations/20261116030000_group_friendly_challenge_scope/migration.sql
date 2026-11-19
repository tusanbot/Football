ALTER TABLE "FriendlyChallenge" ADD COLUMN "groupId" TEXT;
CREATE INDEX "FriendlyChallenge_groupId_status_expiresAt_idx" ON "FriendlyChallenge"("groupId", "status", "expiresAt");
ALTER TABLE "FriendlyChallenge" ADD CONSTRAINT "FriendlyChallenge_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
