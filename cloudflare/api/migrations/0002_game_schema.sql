-- Generated from apps/api/prisma/schema.prisma. Do not edit by hand.
-- BigInt uses signed 64-bit SQLite INTEGER; D1 code MUST bind decimal strings and read CAST(column AS TEXT).
-- cuid()/uuid() and @updatedAt remain application-managed.
-- Review this migration against the PostgreSQL migration history before applying.

CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "telegramId" TEXT NOT NULL UNIQUE,
  "username" TEXT,
  "displayName" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL,
  "isSuspended" INTEGER NOT NULL DEFAULT 0 CHECK (isSuspended IN (0, 1)),
  "suspendedAt" TEXT,
  "suspensionReason" TEXT
);
CREATE TABLE IF NOT EXISTS "Club" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "ownerId" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "logoData" TEXT,
  "logoMime" TEXT CHECK (logoMime IS NULL OR length(logoMime) <= 32),
  "level" INTEGER NOT NULL DEFAULT 1,
  "reputation" INTEGER NOT NULL DEFAULT 0,
  "formation" TEXT NOT NULL DEFAULT '4-3-3',
  "mentality" TEXT NOT NULL DEFAULT 'BALANCED',
  "pressing" TEXT NOT NULL DEFAULT 'MID_BLOCK',
  "tempo" TEXT NOT NULL DEFAULT 'NORMAL',
  "passingStyle" TEXT NOT NULL DEFAULT 'MIXED',
  "matchFallbackPlan" TEXT CHECK (matchFallbackPlan IS NULL OR json_valid(matchFallbackPlan)),
  "matchFallbackPlanVersion" INTEGER NOT NULL DEFAULT 1,
  "lineupVersion" INTEGER NOT NULL DEFAULT 0,
  "trainingGroundLevel" INTEGER NOT NULL DEFAULT 1,
  "lastDailyTickAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastPayrollAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "wageArrears" INTEGER NOT NULL DEFAULT 0,
  "stadiumLevel" INTEGER NOT NULL DEFAULT 1,
  "ticketPrice" INTEGER NOT NULL DEFAULT 50,
  "academyLevel" INTEGER NOT NULL DEFAULT 0,
  "lastEconomyTickAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "operatingArrears" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "Player" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clubId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "nationality" TEXT NOT NULL CHECK (nationality IS NULL OR length(nationality) <= 2),
  "age" INTEGER NOT NULL,
  "position" TEXT NOT NULL CHECK (position IN ('GK', 'RB', 'LB', 'CB', 'CDM', 'CM', 'CAM', 'RW', 'LW', 'ST')),
  "overall" INTEGER NOT NULL,
  "potential" INTEGER NOT NULL,
  "marketValue" INTEGER NOT NULL DEFAULT 1000,
  "attributes" TEXT NOT NULL CHECK (attributes IS NULL OR json_valid(attributes)),
  "wage" INTEGER NOT NULL,
  "contractDays" INTEGER NOT NULL,
  "morale" INTEGER NOT NULL DEFAULT 75,
  "fitness" INTEGER NOT NULL DEFAULT 100,
  "origin" TEXT NOT NULL DEFAULT 'GENERATED' CHECK (origin IN ('GENERATED', 'SPECIAL')),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LISTED', 'INJURED', 'RETIRED', 'CONTRACT_EXPIRED')),
  "lineupSlot" INTEGER,
  "ageDays" INTEGER NOT NULL DEFAULT 0,
  "trainingFocus" TEXT NOT NULL DEFAULT 'BALANCED' CHECK (trainingFocus IN ('BALANCED', 'GOALKEEPING', 'DEFENDING', 'PASSING', 'PLAYMAKING', 'DRIBBLING', 'SHOOTING', 'PHYSICAL')),
  "injuryUntil" TEXT,
  "suspensionMatchesRemaining" INTEGER NOT NULL DEFAULT 0,
  "lastTrainedAt" TEXT,
  "specialPlayerId" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("specialPlayerId") REFERENCES "SpecialPlayer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "Coach" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clubId" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "level" INTEGER NOT NULL DEFAULT 1,
  "trainingSkill" INTEGER NOT NULL DEFAULT 35,
  "recoverySkill" INTEGER NOT NULL DEFAULT 30,
  "medicalSkill" INTEGER NOT NULL DEFAULT 25,
  "weeklySalary" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "ClubDailyTick" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clubId" TEXT NOT NULL,
  "gameDate" TEXT NOT NULL,
  "elapsedDays" INTEGER NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "ClubPayroll" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clubId" TEXT NOT NULL,
  "payrollDate" TEXT NOT NULL,
  "weeksCovered" INTEGER NOT NULL,
  "playerWages" INTEGER NOT NULL,
  "coachWages" INTEGER NOT NULL,
  "arrearsBefore" INTEGER NOT NULL,
  "totalDue" INTEGER NOT NULL,
  "cashPaid" INTEGER NOT NULL,
  "arrearsAfter" INTEGER NOT NULL,
  "playersCount" INTEGER NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "PlayerTrainingLog" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "userId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "trainingDate" TEXT NOT NULL,
  "focus" TEXT NOT NULL CHECK (focus IN ('BALANCED', 'GOALKEEPING', 'DEFENDING', 'PASSING', 'PLAYMAKING', 'DRIBBLING', 'SHOOTING', 'PHYSICAL')),
  "intensity" TEXT NOT NULL CHECK (intensity IN ('LIGHT', 'NORMAL', 'INTENSE')),
  "cashCost" INTEGER NOT NULL,
  "overallBefore" INTEGER NOT NULL,
  "overallAfter" INTEGER NOT NULL,
  "fitnessBefore" INTEGER NOT NULL,
  "fitnessAfter" INTEGER NOT NULL,
  "attributesBefore" TEXT NOT NULL CHECK (attributesBefore IS NULL OR json_valid(attributesBefore)),
  "attributesAfter" TEXT NOT NULL CHECK (attributesAfter IS NULL OR json_valid(attributesAfter)),
  "injuryOccurred" INTEGER NOT NULL DEFAULT 0 CHECK (injuryOccurred IN (0, 1)),
  "injuryUntil" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "PlayerContractRenewal" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "userId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "extensionDays" INTEGER NOT NULL,
  "oldContractDays" INTEGER NOT NULL,
  "newContractDays" INTEGER NOT NULL,
  "oldWage" INTEGER NOT NULL,
  "newWage" INTEGER NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "SponsorContract" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "clubId" TEXT NOT NULL,
  "partnerName" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "dailyIncome" INTEGER NOT NULL,
  "signingBonus" INTEGER NOT NULL,
  "startedAt" TEXT NOT NULL,
  "endsAt" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "AcademyProspect" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clubId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "nationality" TEXT NOT NULL CHECK (nationality IS NULL OR length(nationality) <= 2),
  "age" INTEGER NOT NULL,
  "position" TEXT NOT NULL CHECK (position IN ('GK', 'RB', 'LB', 'CB', 'CDM', 'CM', 'CAM', 'RW', 'LW', 'ST')),
  "overall" INTEGER NOT NULL,
  "potential" INTEGER NOT NULL,
  "attributes" TEXT NOT NULL CHECK (attributes IS NULL OR json_valid(attributes)),
  "recruitmentCost" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'RECRUITED', 'RELEASED')),
  "recruitedPlayerId" TEXT UNIQUE,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recruitedAt" TEXT,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "ClubFinanceEntry" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "clubId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "direction" TEXT NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
  "amount" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "occurredAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "ClubEconomyTick" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clubId" TEXT NOT NULL,
  "gameDate" TEXT NOT NULL,
  "elapsedDays" INTEGER NOT NULL,
  "income" INTEGER NOT NULL,
  "expenses" INTEGER NOT NULL,
  "paid" INTEGER NOT NULL,
  "arrears" INTEGER NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "Competition" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "season" INTEGER NOT NULL,
  "format" TEXT NOT NULL DEFAULT 'LEAGUE' CHECK (format IN ('LEAGUE', 'CUP')),
  "status" TEXT NOT NULL DEFAULT 'REGISTRATION' CHECK (status IN ('DRAFT', 'REGISTRATION', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  "maxTeams" INTEGER NOT NULL DEFAULT 8,
  "cupLegs" INTEGER NOT NULL DEFAULT 1,
  "rules" TEXT CHECK (rules IS NULL OR json_valid(rules)),
  "createdByClubId" TEXT NOT NULL,
  "groupId" TEXT,
  "allianceId" TEXT,
  "allianceSeasonId" TEXT,
  "startsAt" TEXT,
  "completedAt" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  FOREIGN KEY ("allianceId") REFERENCES "Alliance" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "PyramidLeague" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "competitionId" TEXT NOT NULL UNIQUE,
  "tier" INTEGER NOT NULL,
  "season" INTEGER NOT NULL,
  "groupNumber" INTEGER NOT NULL,
  "promotionProcessedAt" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("competitionId") REFERENCES "Competition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "LeagueAward" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "leagueId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "season" INTEGER NOT NULL,
  "tier" INTEGER NOT NULL,
  "placement" INTEGER NOT NULL,
  "awardName" TEXT NOT NULL,
  "awardType" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("leagueId") REFERENCES "PyramidLeague" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "PyramidLeagueEntry" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "leagueId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "joinedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalPosition" INTEGER,
  FOREIGN KEY ("leagueId") REFERENCES "PyramidLeague" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "PyramidLeagueApplication" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "tier" INTEGER NOT NULL,
  "season" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'ASSIGNED', 'WITHDRAWN')),
  "appliedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedLeagueId" TEXT,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "LeaguePromotionOffer" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "leagueId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "targetTier" INTEGER NOT NULL,
  "finalPosition" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'REPLACED')),
  "offeredAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TEXT NOT NULL,
  "resolvedAt" TEXT,
  FOREIGN KEY ("leagueId") REFERENCES "PyramidLeague" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "LeagueNotice" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "referenceId" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TEXT,
  "deliveredAt" TEXT,
  "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  "deliveryClaimToken" TEXT,
  "deliveryLockedUntil" TEXT,
  "deliveryLastError" TEXT,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "FriendlyChallenge" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "creatorUserId" TEXT NOT NULL,
  "creatorClubId" TEXT NOT NULL,
  "groupId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACCEPTED', 'CANCELLED', 'EXPIRED')),
  "matchId" TEXT UNIQUE,
  "expiresAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("creatorUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("creatorClubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "ChallengeDailyUsage" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "usageDate" TEXT NOT NULL,
  "freeUsed" INTEGER NOT NULL DEFAULT 0,
  "goldUsed" INTEGER NOT NULL DEFAULT 0,
  "purchasedCredits" INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "CompetitionEntry" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "competitionId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "played" INTEGER NOT NULL DEFAULT 0,
  "won" INTEGER NOT NULL DEFAULT 0,
  "drawn" INTEGER NOT NULL DEFAULT 0,
  "lost" INTEGER NOT NULL DEFAULT 0,
  "goalsFor" INTEGER NOT NULL DEFAULT 0,
  "goalsAgainst" INTEGER NOT NULL DEFAULT 0,
  "points" INTEGER NOT NULL DEFAULT 0,
  "joinedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("competitionId") REFERENCES "Competition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "FootballMatch" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "type" TEXT NOT NULL DEFAULT 'FRIENDLY' CHECK (type IN ('FRIENDLY', 'LEAGUE', 'CUP')),
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  "homeClubId" TEXT NOT NULL,
  "awayClubId" TEXT NOT NULL,
  "competitionId" TEXT,
  "rulesSnapshot" TEXT CHECK (rulesSnapshot IS NULL OR json_valid(rulesSnapshot)),
  "tieId" TEXT,
  "leg" INTEGER NOT NULL DEFAULT 1,
  "round" INTEGER,
  "scheduledAt" TEXT NOT NULL,
  "startedAt" TEXT,
  "completedAt" TEXT,
  "seed" TEXT NOT NULL,
  "simulationVersion" INTEGER NOT NULL DEFAULT 1,
  "homeScore" INTEGER,
  "awayScore" INTEGER,
  "homePenalties" INTEGER,
  "awayPenalties" INTEGER,
  "winnerClubId" TEXT,
  "attendance" INTEGER NOT NULL DEFAULT 0,
  "ticketRevenue" INTEGER NOT NULL DEFAULT 0,
  "homeExpectedGoals" REAL,
  "awayExpectedGoals" REAL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("homeClubId") REFERENCES "Club" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("awayClubId") REFERENCES "Club" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("competitionId") REFERENCES "Competition" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "MatchRuntime" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "matchId" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'AWAITING_CHECKPOINT', 'COMPLETED', 'FAILED')),
  "currentMinute" INTEGER NOT NULL DEFAULT 0,
  "stateVersion" INTEGER NOT NULL DEFAULT 1,
  "nextActionAt" TEXT,
  "kickoffSnapshot" TEXT CHECK (kickoffSnapshot IS NULL OR json_valid(kickoffSnapshot)),
  "simulationState" TEXT CHECK (simulationState IS NULL OR json_valid(simulationState)),
  "fallbackPlan" TEXT CHECK (fallbackPlan IS NULL OR json_valid(fallbackPlan)),
  "leaseOwner" TEXT,
  "leaseToken" TEXT,
  "leaseExpiresAt" TEXT,
  "lastError" TEXT,
  "startedAt" TEXT,
  "completedAt" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("matchId") REFERENCES "FootballMatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "MatchTacticalCheckpoint" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "matchId" TEXT NOT NULL,
  "checkpointKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK (kind IN ('HALF_TIME', 'MINUTE_60', 'MINUTE_75')),
  "minute" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'EXPIRED')),
  "openedAt" TEXT NOT NULL,
  "decisionDeadlineAt" TEXT NOT NULL,
  "nextSegmentAt" TEXT NOT NULL,
  "resolvedAt" TEXT,
  "resolution" TEXT CHECK (resolution IS NULL OR json_valid(resolution)),
  "homeBotNotifiedAt" TEXT,
  "awayBotNotifiedAt" TEXT,
  "homeBotNotificationClaimedAt" TEXT,
  "awayBotNotificationClaimedAt" TEXT,
  "homeBotNotificationAttempts" INTEGER NOT NULL DEFAULT 0,
  "awayBotNotificationAttempts" INTEGER NOT NULL DEFAULT 0,
  "homeBotNotificationLastError" TEXT,
  "awayBotNotificationLastError" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("matchId") REFERENCES "FootballMatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "MatchTacticalDecision" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "checkpointId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "submittedByUserId" TEXT NOT NULL,
  "instruction" TEXT NOT NULL CHECK (instruction IS NULL OR json_valid(instruction)),
  "submittedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("checkpointId") REFERENCES "MatchTacticalCheckpoint" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "MatchEvent" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "matchId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "minute" INTEGER NOT NULL,
  "type" TEXT NOT NULL CHECK (type IN ('GOAL', 'YELLOW_CARD', 'RED_CARD', 'INJURY', 'SUBSTITUTION')),
  "teamId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "relatedPlayerId" TEXT,
  "detail" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("matchId") REFERENCES "FootballMatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "PlayerMatchPerformance" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "matchId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "minutesPlayed" INTEGER NOT NULL DEFAULT 90,
  "goals" INTEGER NOT NULL DEFAULT 0,
  "assists" INTEGER NOT NULL DEFAULT 0,
  "shots" INTEGER NOT NULL DEFAULT 0,
  "passes" INTEGER NOT NULL DEFAULT 0,
  "tackles" INTEGER NOT NULL DEFAULT 0,
  "yellowCards" INTEGER NOT NULL DEFAULT 0,
  "redCards" INTEGER NOT NULL DEFAULT 0,
  "rating" REAL NOT NULL,
  "fitnessLoss" INTEGER NOT NULL,
  FOREIGN KEY ("matchId") REFERENCES "FootballMatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "SpecialPlayer" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "fullName" TEXT NOT NULL,
  "nationality" TEXT NOT NULL CHECK (nationality IS NULL OR length(nationality) <= 2),
  "birthDate" TEXT,
  "positions" TEXT NOT NULL CHECK (positions IS NULL OR json_valid(positions)),
  "rarity" TEXT NOT NULL DEFAULT 'RARE' CHECK (rarity IN ('RARE', 'EPIC', 'LEGENDARY', 'ICON')),
  "acquisitionMethods" TEXT NOT NULL DEFAULT '[]' CHECK (acquisitionMethods IS NULL OR json_valid(acquisitionMethods)),
  "overall" INTEGER NOT NULL,
  "potential" INTEGER NOT NULL,
  "attributes" TEXT NOT NULL CHECK (attributes IS NULL OR json_valid(attributes)),
  "sourceNote" TEXT,
  "active" INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "SpecialPlayerAcquisition" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "userId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "specialPlayerId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL UNIQUE,
  "method" TEXT NOT NULL,
  "asset" TEXT NOT NULL DEFAULT 'GOLD' CHECK (asset IN ('CASH', 'GOLD')),
  "amount" INTEGER NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("specialPlayerId") REFERENCES "SpecialPlayer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "PlayerMarketListing" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "playerId" TEXT NOT NULL,
  "sellerClubId" TEXT NOT NULL,
  "buyerClubId" TEXT,
  "askingPrice" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SOLD', 'CANCELLED', 'EXPIRED')),
  "expiresAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("sellerClubId") REFERENCES "Club" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("buyerClubId") REFERENCES "Club" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "Wallet" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "asset" TEXT NOT NULL CHECK (asset IN ('CASH', 'GOLD')),
  "balance" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "LedgerTransaction" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "userId" TEXT NOT NULL,
  "asset" TEXT NOT NULL CHECK (asset IN ('CASH', 'GOLD')),
  "direction" TEXT NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
  "amount" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "TelegramGroup" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "telegramId" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "memberCount" INTEGER NOT NULL DEFAULT 0,
  "isActive" INTEGER NOT NULL DEFAULT 0 CHECK (isActive IN (0, 1)),
  "points" INTEGER NOT NULL DEFAULT 0,
  "lastMemberCountCheckAt" TEXT,
  "isSuspended" INTEGER NOT NULL DEFAULT 0 CHECK (isSuspended IN (0, 1)),
  "suspendedAt" TEXT,
  "suspensionReason" TEXT
);
CREATE TABLE IF NOT EXISTS "GroupMembership" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "groupId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
  "joinedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "GroupChallenge" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "idempotencyKey" TEXT UNIQUE,
  "groupId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'OPEN', 'RUNNING', 'COMPLETED', 'CANCELLED')),
  "startsAt" TEXT,
  "endsAt" TEXT,
  "rewardPoints" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "GroupChallengeParticipant" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "challengeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "joinedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("challengeId") REFERENCES "GroupChallenge" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "GroupMemberRewardBalance" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "groupId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "GroupPointLedger" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "groupId" TEXT NOT NULL,
  "userId" TEXT,
  "amount" INTEGER NOT NULL,
  "source" TEXT NOT NULL CHECK (source IN ('DAILY_ACTIVITY', 'CHALLENGE_REWARD', 'LEAGUE_REWARD', 'ADMIN_ADJUSTMENT', 'SHOP_PURCHASE', 'GAME_ACTIVITY', 'GIFT_CODE')),
  "description" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "GroupRewardItem" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "cost" INTEGER NOT NULL,
  "scope" TEXT NOT NULL,
  "active" INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "GroupRewardGrant" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "groupId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "grantedByUserId" TEXT NOT NULL,
  "recipientUserId" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("itemId") REFERENCES "GroupRewardItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "Alliance" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISSOLVED')),
  "treasuryPoints" INTEGER NOT NULL DEFAULT 0,
  "createdByGroupId" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("createdByGroupId") REFERENCES "TelegramGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "AllianceGroup" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "allianceId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL UNIQUE,
  "role" TEXT NOT NULL DEFAULT 'MEMBER',
  "joinedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("allianceId") REFERENCES "Alliance" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "AllianceInvitation" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "allianceId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "invitedByGroupId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TEXT,
  FOREIGN KEY ("allianceId") REFERENCES "Alliance" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "AllianceSeason" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "allianceId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "startsAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TEXT NOT NULL,
  "closedAt" TEXT,
  "standings" TEXT CHECK (standings IS NULL OR json_valid(standings)),
  "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING' CHECK (reviewStatus IN ('PENDING', 'FLAGGED', 'APPROVED', 'REJECTED')),
  "securityFlags" TEXT CHECK (securityFlags IS NULL OR json_valid(securityFlags)),
  "reviewedAt" TEXT,
  "reviewedByUserId" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("allianceId") REFERENCES "Alliance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "AllianceLedger" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "allianceId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "amount" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("allianceId") REFERENCES "Alliance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "AllianceActionThrottle" (
  "key" TEXT PRIMARY KEY NOT NULL,
  "windowStart" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "AllianceAuditLog" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "allianceId" TEXT NOT NULL,
  "actorTelegramId" TEXT NOT NULL,
  "groupTelegramId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "metadata" TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("allianceId") REFERENCES "Alliance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "GiftCode" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "code" TEXT NOT NULL UNIQUE,
  "rewardType" TEXT NOT NULL DEFAULT 'WALLET' CHECK (rewardType IN ('WALLET', 'GROUP_POINTS')),
  "cashAmount" INTEGER NOT NULL DEFAULT 0,
  "goldAmount" INTEGER NOT NULL DEFAULT 0,
  "groupPoints" INTEGER NOT NULL DEFAULT 0,
  "maxRedemptions" INTEGER NOT NULL DEFAULT 1,
  "redeemedCount" INTEGER NOT NULL DEFAULT 0,
  "perUserLimit" INTEGER NOT NULL DEFAULT 1,
  "active" INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  "startsAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TEXT,
  "createdByTelegramId" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "GiftCodeRedemption" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "giftCodeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "cashAmount" INTEGER NOT NULL DEFAULT 0,
  "goldAmount" INTEGER NOT NULL DEFAULT 0,
  "groupPoints" INTEGER NOT NULL DEFAULT 0,
  "redeemedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "groupId" TEXT,
  FOREIGN KEY ("giftCodeId") REFERENCES "GiftCode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("groupId") REFERENCES "TelegramGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "actorTelegramId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "reason" TEXT,
  "metadata" TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "TelegramMessageDeletion" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "telegramChatId" INTEGER NOT NULL,
  "messageId" INTEGER NOT NULL,
  "deleteAt" TEXT NOT NULL,
  "availableAt" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'DELETED', 'FAILED')),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TEXT,
  "claimToken" TEXT,
  "lastError" TEXT,
  "deletedAt" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "AdminRoleAssignment" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "telegramId" TEXT NOT NULL UNIQUE,
  "role" TEXT NOT NULL,
  "active" INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  "createdByTelegramId" TEXT NOT NULL,
  "updatedByTelegramId" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "GameSetting" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "key" TEXT NOT NULL UNIQUE,
  "value" TEXT NOT NULL CHECK (value IS NULL OR json_valid(value)),
  "description" TEXT,
  "updatedByTelegramId" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "SeasonPlayerAward" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "season" INTEGER NOT NULL,
  "playerId" TEXT NOT NULL,
  "awardType" TEXT NOT NULL,
  "awardName" TEXT NOT NULL,
  "reason" TEXT,
  "createdByTelegramId" TEXT NOT NULL,
  "updatedByTelegramId" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "AdminGroupBroadcast" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "message" TEXT NOT NULL,
  "createdByTelegramId" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "AdminGroupBroadcastDelivery" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "broadcastId" TEXT NOT NULL,
  "telegramGroupId" TEXT NOT NULL,
  "groupTitle" TEXT NOT NULL,
  "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveryClaimToken" TEXT,
  "deliveryLockedUntil" TEXT,
  "deliveredAt" TEXT,
  "deliveryLastError" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("broadcastId") REFERENCES "AdminGroupBroadcast" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "BotRuntimeLease" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "instanceId" TEXT NOT NULL,
  "lockedUntil" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

-- Secondary indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_Player_clubId_lineupSlot ON "Player" ("clubId", "lineupSlot");
CREATE UNIQUE INDEX IF NOT EXISTS uq_Player_clubId_specialPlayerId ON "Player" ("clubId", "specialPlayerId");
CREATE INDEX IF NOT EXISTS ix_Player_clubId_status ON "Player" ("clubId", "status");
CREATE INDEX IF NOT EXISTS ix_Player_clubId_position ON "Player" ("clubId", "position");
CREATE INDEX IF NOT EXISTS ix_Player_nationality ON "Player" ("nationality");
CREATE UNIQUE INDEX IF NOT EXISTS uq_ClubDailyTick_clubId_gameDate ON "ClubDailyTick" ("clubId", "gameDate");
CREATE INDEX IF NOT EXISTS ix_ClubDailyTick_gameDate ON "ClubDailyTick" ("gameDate");
CREATE UNIQUE INDEX IF NOT EXISTS uq_ClubPayroll_clubId_payrollDate ON "ClubPayroll" ("clubId", "payrollDate");
CREATE INDEX IF NOT EXISTS ix_ClubPayroll_payrollDate ON "ClubPayroll" ("payrollDate");
CREATE UNIQUE INDEX IF NOT EXISTS uq_PlayerTrainingLog_playerId_trainingDate ON "PlayerTrainingLog" ("playerId", "trainingDate");
CREATE INDEX IF NOT EXISTS ix_PlayerTrainingLog_clubId_trainingDate ON "PlayerTrainingLog" ("clubId", "trainingDate");
CREATE INDEX IF NOT EXISTS ix_PlayerTrainingLog_userId_createdAt ON "PlayerTrainingLog" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS ix_PlayerContractRenewal_clubId_createdAt ON "PlayerContractRenewal" ("clubId", "createdAt");
CREATE INDEX IF NOT EXISTS ix_PlayerContractRenewal_playerId_createdAt ON "PlayerContractRenewal" ("playerId", "createdAt");
CREATE INDEX IF NOT EXISTS ix_SponsorContract_clubId_status_endsAt ON "SponsorContract" ("clubId", "status", "endsAt");
CREATE INDEX IF NOT EXISTS ix_AcademyProspect_clubId_status_createdAt ON "AcademyProspect" ("clubId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS ix_ClubFinanceEntry_clubId_occurredAt ON "ClubFinanceEntry" ("clubId", "occurredAt");
CREATE INDEX IF NOT EXISTS ix_ClubFinanceEntry_clubId_category_occurredAt ON "ClubFinanceEntry" ("clubId", "category", "occurredAt");
CREATE UNIQUE INDEX IF NOT EXISTS uq_ClubEconomyTick_clubId_gameDate ON "ClubEconomyTick" ("clubId", "gameDate");
CREATE INDEX IF NOT EXISTS ix_ClubEconomyTick_gameDate ON "ClubEconomyTick" ("gameDate");
CREATE INDEX IF NOT EXISTS ix_Competition_status_createdAt ON "Competition" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS ix_Competition_groupId_status ON "Competition" ("groupId", "status");
CREATE INDEX IF NOT EXISTS ix_Competition_allianceId ON "Competition" ("allianceId");
CREATE UNIQUE INDEX IF NOT EXISTS uq_PyramidLeague_tier_season_groupNumber ON "PyramidLeague" ("tier", "season", "groupNumber");
CREATE INDEX IF NOT EXISTS ix_PyramidLeague_tier_season ON "PyramidLeague" ("tier", "season");
CREATE UNIQUE INDEX IF NOT EXISTS uq_LeagueAward_leagueId_placement ON "LeagueAward" ("leagueId", "placement");
CREATE INDEX IF NOT EXISTS ix_LeagueAward_clubId_season_tier ON "LeagueAward" ("clubId", "season", "tier");
CREATE UNIQUE INDEX IF NOT EXISTS uq_PyramidLeagueEntry_leagueId_clubId ON "PyramidLeagueEntry" ("leagueId", "clubId");
CREATE INDEX IF NOT EXISTS ix_PyramidLeagueEntry_clubId_joinedAt ON "PyramidLeagueEntry" ("clubId", "joinedAt");
CREATE UNIQUE INDEX IF NOT EXISTS uq_PyramidLeagueApplication_clubId_tier_season ON "PyramidLeagueApplication" ("clubId", "tier", "season");
CREATE INDEX IF NOT EXISTS ix_PyramidLeagueApplication_tier_season_status_appliedAt ON "PyramidLeagueApplication" ("tier", "season", "status", "appliedAt");
CREATE UNIQUE INDEX IF NOT EXISTS uq_LeaguePromotionOffer_leagueId_clubId ON "LeaguePromotionOffer" ("leagueId", "clubId");
CREATE INDEX IF NOT EXISTS ix_LeaguePromotionOffer_clubId_status_offeredAt ON "LeaguePromotionOffer" ("clubId", "status", "offeredAt");
CREATE INDEX IF NOT EXISTS ix_LeagueNotice_userId_readAt_createdAt ON "LeagueNotice" ("userId", "readAt", "createdAt");
CREATE INDEX IF NOT EXISTS ix_FriendlyChallenge_groupId_status_expiresAt ON "FriendlyChallenge" ("groupId", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS ix_FriendlyChallenge_status_expiresAt ON "FriendlyChallenge" ("status", "expiresAt");
CREATE INDEX IF NOT EXISTS ix_FriendlyChallenge_creatorClubId_createdAt ON "FriendlyChallenge" ("creatorClubId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS uq_ChallengeDailyUsage_userId_usageDate ON "ChallengeDailyUsage" ("userId", "usageDate");
CREATE UNIQUE INDEX IF NOT EXISTS uq_CompetitionEntry_competitionId_clubId ON "CompetitionEntry" ("competitionId", "clubId");
CREATE INDEX IF NOT EXISTS ix_CompetitionEntry_competitionId_points_goalsFor ON "CompetitionEntry" ("competitionId", "points", "goalsFor");
CREATE INDEX IF NOT EXISTS ix_FootballMatch_homeClubId_scheduledAt_status ON "FootballMatch" ("homeClubId", "scheduledAt", "status");
CREATE INDEX IF NOT EXISTS ix_FootballMatch_awayClubId_scheduledAt_status ON "FootballMatch" ("awayClubId", "scheduledAt", "status");
CREATE INDEX IF NOT EXISTS ix_FootballMatch_competitionId_round ON "FootballMatch" ("competitionId", "round");
CREATE INDEX IF NOT EXISTS ix_FootballMatch_competitionId_round_tieId ON "FootballMatch" ("competitionId", "round", "tieId");
CREATE INDEX IF NOT EXISTS ix_FootballMatch_status_scheduledAt ON "FootballMatch" ("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS ix_MatchRuntime_status_nextActionAt ON "MatchRuntime" ("status", "nextActionAt");
CREATE INDEX IF NOT EXISTS ix_MatchRuntime_leaseExpiresAt ON "MatchRuntime" ("leaseExpiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS uq_MatchTacticalCheckpoint_matchId_checkpointKey ON "MatchTacticalCheckpoint" ("matchId", "checkpointKey");
CREATE INDEX IF NOT EXISTS ix_MatchTacticalCheckpoint_status_nextSegmentAt ON "MatchTacticalCheckpoint" ("status", "nextSegmentAt");
CREATE INDEX IF NOT EXISTS ix_MatchTacticalCheckpoint_matchId_minute ON "MatchTacticalCheckpoint" ("matchId", "minute");
CREATE INDEX IF NOT EXISTS ix_MatchTacticalDecision_checkpointId_clubId_submittedAt ON "MatchTacticalDecision" ("checkpointId", "clubId", "submittedAt");
CREATE INDEX IF NOT EXISTS ix_MatchTacticalDecision_clubId_submittedAt ON "MatchTacticalDecision" ("clubId", "submittedAt");
CREATE UNIQUE INDEX IF NOT EXISTS uq_MatchEvent_matchId_sequence ON "MatchEvent" ("matchId", "sequence");
CREATE INDEX IF NOT EXISTS ix_MatchEvent_matchId_minute ON "MatchEvent" ("matchId", "minute");
CREATE UNIQUE INDEX IF NOT EXISTS uq_PlayerMatchPerformance_matchId_playerId ON "PlayerMatchPerformance" ("matchId", "playerId");
CREATE INDEX IF NOT EXISTS ix_PlayerMatchPerformance_clubId_matchId ON "PlayerMatchPerformance" ("clubId", "matchId");
CREATE INDEX IF NOT EXISTS ix_PlayerMatchPerformance_playerId_matchId ON "PlayerMatchPerformance" ("playerId", "matchId");
CREATE INDEX IF NOT EXISTS ix_SpecialPlayerAcquisition_userId_createdAt ON "SpecialPlayerAcquisition" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS ix_SpecialPlayerAcquisition_clubId_createdAt ON "SpecialPlayerAcquisition" ("clubId", "createdAt");
CREATE INDEX IF NOT EXISTS ix_SpecialPlayerAcquisition_specialPlayerId_createdAt ON "SpecialPlayerAcquisition" ("specialPlayerId", "createdAt");
CREATE INDEX IF NOT EXISTS ix_PlayerMarketListing_status_expiresAt_createdAt ON "PlayerMarketListing" ("status", "expiresAt", "createdAt");
CREATE INDEX IF NOT EXISTS ix_PlayerMarketListing_sellerClubId_status ON "PlayerMarketListing" ("sellerClubId", "status");
CREATE INDEX IF NOT EXISTS ix_PlayerMarketListing_playerId_status ON "PlayerMarketListing" ("playerId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS uq_Wallet_userId_asset ON "Wallet" ("userId", "asset");
CREATE INDEX IF NOT EXISTS ix_LedgerTransaction_userId_createdAt ON "LedgerTransaction" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS ix_LedgerTransaction_referenceType_referenceId ON "LedgerTransaction" ("referenceType", "referenceId");
CREATE UNIQUE INDEX IF NOT EXISTS uq_GroupMembership_groupId_userId ON "GroupMembership" ("groupId", "userId");
CREATE INDEX IF NOT EXISTS ix_GroupChallenge_groupId_status ON "GroupChallenge" ("groupId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS uq_GroupChallengeParticipant_challengeId_userId ON "GroupChallengeParticipant" ("challengeId", "userId");
CREATE INDEX IF NOT EXISTS ix_GroupChallengeParticipant_userId_joinedAt ON "GroupChallengeParticipant" ("userId", "joinedAt");
CREATE UNIQUE INDEX IF NOT EXISTS uq_GroupMemberRewardBalance_groupId_userId ON "GroupMemberRewardBalance" ("groupId", "userId");
CREATE INDEX IF NOT EXISTS ix_GroupPointLedger_groupId_createdAt ON "GroupPointLedger" ("groupId", "createdAt");
CREATE INDEX IF NOT EXISTS ix_GroupPointLedger_userId_createdAt ON "GroupPointLedger" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS ix_GroupRewardGrant_groupId_createdAt ON "GroupRewardGrant" ("groupId", "createdAt");
CREATE INDEX IF NOT EXISTS ix_GroupRewardGrant_recipientUserId_createdAt ON "GroupRewardGrant" ("recipientUserId", "createdAt");
CREATE INDEX IF NOT EXISTS ix_Alliance_status_createdAt ON "Alliance" ("status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS uq_AllianceGroup_allianceId_groupId ON "AllianceGroup" ("allianceId", "groupId");
CREATE INDEX IF NOT EXISTS ix_AllianceGroup_allianceId_joinedAt ON "AllianceGroup" ("allianceId", "joinedAt");
CREATE UNIQUE INDEX IF NOT EXISTS uq_AllianceInvitation_allianceId_groupId ON "AllianceInvitation" ("allianceId", "groupId");
CREATE INDEX IF NOT EXISTS ix_AllianceInvitation_groupId_status ON "AllianceInvitation" ("groupId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS uq_AllianceSeason_allianceId_number ON "AllianceSeason" ("allianceId", "number");
CREATE INDEX IF NOT EXISTS ix_AllianceSeason_allianceId_status_endsAt ON "AllianceSeason" ("allianceId", "status", "endsAt");
CREATE INDEX IF NOT EXISTS ix_AllianceLedger_allianceId_createdAt ON "AllianceLedger" ("allianceId", "createdAt");
CREATE INDEX IF NOT EXISTS ix_AllianceActionThrottle_updatedAt ON "AllianceActionThrottle" ("updatedAt");
CREATE INDEX IF NOT EXISTS ix_AllianceAuditLog_allianceId_createdAt ON "AllianceAuditLog" ("allianceId", "createdAt");
CREATE INDEX IF NOT EXISTS ix_AllianceAuditLog_actorTelegramId_createdAt ON "AllianceAuditLog" ("actorTelegramId", "createdAt");
CREATE INDEX IF NOT EXISTS ix_GiftCode_active_startsAt_expiresAt ON "GiftCode" ("active", "startsAt", "expiresAt");
CREATE INDEX IF NOT EXISTS ix_GiftCodeRedemption_giftCodeId_userId ON "GiftCodeRedemption" ("giftCodeId", "userId");
CREATE INDEX IF NOT EXISTS ix_GiftCodeRedemption_userId_redeemedAt ON "GiftCodeRedemption" ("userId", "redeemedAt");
CREATE INDEX IF NOT EXISTS ix_GiftCodeRedemption_groupId_redeemedAt ON "GiftCodeRedemption" ("groupId", "redeemedAt");
CREATE INDEX IF NOT EXISTS ix_AdminAuditLog_actorTelegramId_createdAt ON "AdminAuditLog" ("actorTelegramId", "createdAt");
CREATE INDEX IF NOT EXISTS ix_AdminAuditLog_targetType_targetId_createdAt ON "AdminAuditLog" ("targetType", "targetId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS uq_TelegramMessageDeletion_telegramChatId_messageId ON "TelegramMessageDeletion" ("telegramChatId", "messageId");
CREATE INDEX IF NOT EXISTS ix_TelegramMessageDeletion_status_deleteAt_availableAt ON "TelegramMessageDeletion" ("status", "deleteAt", "availableAt");
CREATE INDEX IF NOT EXISTS ix_TelegramMessageDeletion_status_lockedUntil ON "TelegramMessageDeletion" ("status", "lockedUntil");
CREATE INDEX IF NOT EXISTS ix_AdminRoleAssignment_role_active ON "AdminRoleAssignment" ("role", "active");
CREATE INDEX IF NOT EXISTS ix_GameSetting_updatedAt ON "GameSetting" ("updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS uq_SeasonPlayerAward_season_playerId_awardType ON "SeasonPlayerAward" ("season", "playerId", "awardType");
CREATE INDEX IF NOT EXISTS ix_SeasonPlayerAward_season_awardType ON "SeasonPlayerAward" ("season", "awardType");
CREATE INDEX IF NOT EXISTS ix_SeasonPlayerAward_playerId_season ON "SeasonPlayerAward" ("playerId", "season");
CREATE UNIQUE INDEX IF NOT EXISTS uq_AdminGroupBroadcastDelivery_broadcastId_telegramGroupId ON "AdminGroupBroadcastDelivery" ("broadcastId", "telegramGroupId");
CREATE INDEX IF NOT EXISTS ix_AdminGroupBroadcastDelivery_deliveredAt_availableAt_deliveryLockedUntil ON "AdminGroupBroadcastDelivery" ("deliveredAt", "availableAt", "deliveryLockedUntil");

CREATE TABLE IF NOT EXISTS fe_write_guard (assertion INTEGER NOT NULL CHECK (assertion = 1));
INSERT OR IGNORE INTO fe_schema_migrations (version) VALUES ('0002_game_schema');

-- Source schema SHA-256: 0342a25eb7930fe3def78663c98359004e6efb3b7691c041216b96df7be805f7
