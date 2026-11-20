import "dotenv/config";
import { buildApp } from "./app.js";
import { processDueMatchRuntimes } from "./game/match-service.js";
import { processDuePromotionOffers } from "./game/league-pyramid-service.js";
import { processDueEventTournamentFinalizations } from "./event-tournament-service.js";
import { withEventTournamentSettlementPort } from "./event-tournament-settlement-context.js";
import { NodeSupabaseGroupMembershipRepository } from "./groups/node-supabase-group-membership.js";
import { NodeSupabaseActionRateLimitRepository } from "./groups/node-supabase-action-rate-limit.js";
import { NodeSupabaseAllianceRepository } from "./groups/node-supabase-alliance.js";
import { NodeSupabaseTelegramUserLookupRepository } from "./auth/node-supabase-telegram-user-lookup.js";
import { NodeSupabaseTelegramAccountProvisioningRepository } from "./auth/node-supabase-telegram-account-provisioning.js";
import { NodeSupabaseStorePurchaseRepository, NodeSupabaseStoreItemUseRepository } from "./store/node-supabase-store.js";
import { NodeSupabaseWalletEntryRepository, NodeSupabaseMarketRepository, NodeSupabaseStoreSnapshotRepository } from "./economy/node-supabase-commerce.js";
import { SupabaseHttpClient } from "./node-supabase-http.js";
import { SupabasePlayerDevelopmentRepository } from "./players/node-supabase-player-development.js";
import { NodeSupabaseClubEconomyRepository } from "./game/node-supabase-club-economy.js";
import { SupabaseClubManagementRepository as NodeSupabaseClubManagementRepository } from "./game/node-supabase-club-management.js";
import { SupabaseSpecialAcquisitionRepository as NodeSupabaseSpecialAcquisitionRepository } from "./players/node-supabase-special-acquisition.js";
import { SupabaseGiftCodeRedemptionRepository as NodeSupabaseGiftCodeRedemptionRepository } from "./node-supabase-gift-code-redemption.js";
import { SupabaseBotRuntimeLeaseRepository as NodeSupabaseBotRuntimeLeaseRepository } from "./node-supabase-bot-runtime-lease.js";
import { createNodeSupabaseMatchPorts, withNodeSupabaseMatchPorts } from "./game/node-supabase-match-ports.js";
import { SupabaseGameDashboardRepository } from "./game/node-supabase-game-dashboard.js";
import { NodeSupabaseWalletReadRepository } from "./economy/node-supabase-wallet-read.js";
import { SupabaseClubLineupRepository } from "./game/node-supabase-club-lineup.js";
import { NodeSupabasePublicPlayerRecordRepository } from "./players/node-supabase-public-records.js";
import { NodeSupabasePublicClubLogoRepository } from "./node-supabase-public-club-logo.js";
import { NodeSupabasePublicClubRepository } from "./node-supabase-public-clubs.js";
import { NodeSupabaseSeasonAwardRepository } from "./game/node-supabase-season-awards.js";
import { NodeSupabaseTelegramMessageDeletionRepository } from "./node-supabase-telegram-message-deletions.js";
import { NodeSupabaseMatchNotificationRepository } from "./game/node-supabase-match-notifications.js";
import { NodeSupabaseAdminGroupBroadcastRepository } from "./node-supabase-admin-group-broadcast.js";
import { NodeSupabaseAdminRoleRepository } from "./node-supabase-admin-role.js";
import { NodeSupabaseAdminConfigurationRepository } from "./node-supabase-admin-configuration.js";
import { NodeSupabaseAdminCatalogActionsRepository } from "./node-supabase-admin-catalog-actions.js";
import { NodeSupabaseAdminEntityUpdateRepository } from "./node-supabase-admin-entity-update.js";
import { NodeSupabaseAdminConsoleReadRepository } from "./node-supabase-admin-console-read.js";
import { NodeSupabaseAdminModerationActionsRepository } from "./node-supabase-admin-moderation-actions.js";
import { NodeSupabaseAdminFinancialAdjustmentsRepository } from "./node-supabase-admin-financial-adjustments.js";
import { NodeSupabaseAdminBroadcastManagementRepository } from "./node-supabase-admin-broadcast-management.js";
import { NodeSupabaseAdminSeasonAwardActionsRepository } from "./node-supabase-admin-season-awards.js";
import { NodeSupabaseAdminBroadcastCreateRepository } from "./node-supabase-admin-broadcast-create.js";
import { NodeSupabaseAdminPyramidLeagueReadRepository } from "./node-supabase-admin-pyramid-league-read.js";
import { NodeSupabaseAdminPyramidLeagueReportsRepository } from "./node-supabase-admin-pyramid-league-reports.js";
import { NodeSupabaseAdminPyramidLeagueActionsRepository } from "./node-supabase-admin-pyramid-league-actions.js";
import { SupabaseEventTournamentSettlementRepository } from "./game/node-supabase-event-tournament-settlement.js";
import { NodeSupabaseEventTournamentReadRepository } from "./node-supabase-event-tournament-read.js";
import { SupabasePyramidLeagueSettlementRepository } from "./game/node-supabase-pyramid-league-settlement.js";
import { withPyramidLeagueSettlementPort } from "./game/pyramid-league-settlement-context.js";
import { isValidTelegramBotToken, parseAdminTelegramIds, parseCorsOrigins } from "./runtime-config.js";
const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN", "BOT_API_SECRET", "CORS_ORIGIN", "GAME_ADMIN_TELEGRAM_IDS"] as const;
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) throw new Error("Missing required runtime configuration: " + missing.join(", "));
if ((process.env.BOT_API_SECRET ?? "").length < 32 || /^(replace-with|change-me|your-)/i.test(process.env.BOT_API_SECRET ?? "")) throw new Error("BOT_API_SECRET must be a unique random secret of at least 32 characters; replace the example value.");
if (!isValidTelegramBotToken(process.env.TELEGRAM_BOT_TOKEN ?? "")) throw new Error("TELEGRAM_BOT_TOKEN does not look like a valid BotFather token.");
const adminIds = parseAdminTelegramIds(process.env.GAME_ADMIN_TELEGRAM_IDS);
if (!adminIds.length) throw new Error("GAME_ADMIN_TELEGRAM_IDS must contain at least one numeric Telegram user ID.");
const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN);
if (!corsOrigins.length) throw new Error("CORS_ORIGIN must contain at least one allowed origin.");
const port = Number(process.env.API_PORT ?? 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("API_PORT must be an integer between 1 and 65535.");
const host = process.env.API_HOST ?? "0.0.0.0";
const hasSupabaseUrl = Boolean(process.env.SUPABASE_URL?.trim());
const hasSupabaseKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
if (hasSupabaseUrl !== hasSupabaseKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured together.");
const groupMembershipPort = hasSupabaseUrl
  ? new NodeSupabaseGroupMembershipRepository(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  : undefined;
const alliancePort = hasSupabaseUrl
  ? new NodeSupabaseAllianceRepository(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  : undefined;
const telegramUserLookupPort = hasSupabaseUrl
  ? new NodeSupabaseTelegramUserLookupRepository(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  : undefined;
const storePurchasePort = hasSupabaseUrl
  ? new NodeSupabaseStorePurchaseRepository(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  : undefined;
const storeItemUsePort = hasSupabaseUrl
  ? new NodeSupabaseStoreItemUseRepository(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  : undefined;
const walletEntryPort = hasSupabaseUrl ? new NodeSupabaseWalletEntryRepository(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) : undefined;
const marketRepository = hasSupabaseUrl ? new NodeSupabaseMarketRepository(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) : undefined;
const storeSnapshotPort = hasSupabaseUrl ? new NodeSupabaseStoreSnapshotRepository(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) : undefined;
const supabaseHttp = hasSupabaseUrl ? new SupabaseHttpClient({ url: process.env.SUPABASE_URL!, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY! }) : undefined;
const accountProvisioningPort = supabaseHttp ? new NodeSupabaseTelegramAccountProvisioningRepository(supabaseHttp) : undefined;
const playerDevelopmentPort = supabaseHttp ? new SupabasePlayerDevelopmentRepository(supabaseHttp) : undefined;
const actionRateLimitPort = supabaseHttp ? new NodeSupabaseActionRateLimitRepository(supabaseHttp) : undefined;
const clubEconomySettlementPort = supabaseHttp ? new NodeSupabaseClubEconomyRepository(supabaseHttp) : undefined;
const clubManagementPort = supabaseHttp ? new NodeSupabaseClubManagementRepository(supabaseHttp) : undefined;
const specialAcquisitionPort = supabaseHttp ? new NodeSupabaseSpecialAcquisitionRepository(supabaseHttp) : undefined;
const giftCodeRedemptionPort = supabaseHttp ? new NodeSupabaseGiftCodeRedemptionRepository(supabaseHttp) : undefined;
const botRuntimeLeasePort = supabaseHttp ? new NodeSupabaseBotRuntimeLeaseRepository(supabaseHttp) : undefined;
const matchPorts = supabaseHttp ? createNodeSupabaseMatchPorts(supabaseHttp) : undefined;
const gameDashboardPort = supabaseHttp ? new SupabaseGameDashboardRepository(supabaseHttp) : undefined;
const walletReadPort = supabaseHttp ? new NodeSupabaseWalletReadRepository(supabaseHttp) : undefined;
const clubLineupPort = supabaseHttp ? new SupabaseClubLineupRepository(supabaseHttp) : undefined;
const publicPlayerRecordRepository = supabaseHttp ? new NodeSupabasePublicPlayerRecordRepository(supabaseHttp) : undefined;
const publicClubLogoRepository = supabaseHttp ? new NodeSupabasePublicClubLogoRepository(supabaseHttp) : undefined;
const publicClubReadRepository = supabaseHttp ? new NodeSupabasePublicClubRepository(supabaseHttp) : undefined;
const seasonAwardRepository = supabaseHttp ? new NodeSupabaseSeasonAwardRepository(supabaseHttp) : undefined;
const telegramMessageDeletionPort = supabaseHttp ? new NodeSupabaseTelegramMessageDeletionRepository(supabaseHttp) : undefined;
const matchNotificationPort = supabaseHttp ? new NodeSupabaseMatchNotificationRepository(supabaseHttp) : undefined;
const adminGroupBroadcastPort = supabaseHttp ? new NodeSupabaseAdminGroupBroadcastRepository(supabaseHttp) : undefined;
const adminRoleLookupPort = supabaseHttp ? new NodeSupabaseAdminRoleRepository(supabaseHttp) : undefined;
const adminConfigurationPort = supabaseHttp ? new NodeSupabaseAdminConfigurationRepository(supabaseHttp) : undefined;
const adminCatalogActionPort = supabaseHttp ? new NodeSupabaseAdminCatalogActionsRepository(supabaseHttp) : undefined;
const adminEntityUpdatePort = supabaseHttp ? new NodeSupabaseAdminEntityUpdateRepository(supabaseHttp) : undefined;
const adminConsoleReadPort = supabaseHttp ? new NodeSupabaseAdminConsoleReadRepository(supabaseHttp) : undefined;
const adminModerationActionPort = supabaseHttp ? new NodeSupabaseAdminModerationActionsRepository(supabaseHttp) : undefined;
const adminFinancialAdjustmentPort = supabaseHttp ? new NodeSupabaseAdminFinancialAdjustmentsRepository(supabaseHttp) : undefined;
const adminBroadcastRetryPort = supabaseHttp ? new NodeSupabaseAdminBroadcastManagementRepository(supabaseHttp) : undefined;
const adminSeasonAwardActionPort = supabaseHttp ? new NodeSupabaseAdminSeasonAwardActionsRepository(supabaseHttp) : undefined;
const adminBroadcastCreatePort = supabaseHttp ? new NodeSupabaseAdminBroadcastCreateRepository(supabaseHttp) : undefined;
const adminPyramidLeagueReadPort = supabaseHttp ? new NodeSupabaseAdminPyramidLeagueReadRepository(supabaseHttp) : undefined;
const adminPyramidLeagueReportsPort = supabaseHttp ? new NodeSupabaseAdminPyramidLeagueReportsRepository(supabaseHttp) : undefined;
const adminPyramidLeagueActionsPort = supabaseHttp ? new NodeSupabaseAdminPyramidLeagueActionsRepository(supabaseHttp) : undefined;
const eventTournamentSettlementPort = supabaseHttp ? new SupabaseEventTournamentSettlementRepository(supabaseHttp) : undefined;
const eventTournamentReadPort = supabaseHttp ? new NodeSupabaseEventTournamentReadRepository(supabaseHttp) : undefined;
const pyramidLeagueSettlementPort = supabaseHttp ? new SupabasePyramidLeagueSettlementRepository(supabaseHttp) : undefined;
const app = buildApp({
  ...(groupMembershipPort ? { groupMembershipPort } : {}),
  ...(actionRateLimitPort ? { actionRateLimitPort } : {}),
  ...(alliancePort ? { alliancePort, adminAlliancePort: alliancePort } : {}),
  ...(telegramUserLookupPort ? { telegramUserLookupPort } : {}),
  ...(accountProvisioningPort ? { accountProvisioningPort } : {}),
  ...(storePurchasePort ? { storePurchasePort } : {}),
  ...(storeItemUsePort ? { storeItemUsePort } : {}),
  ...(walletEntryPort ? { walletEntryPort } : {}),
  ...(marketRepository ? { marketListingPort: marketRepository, marketPurchasePort: marketRepository } : {}),
  ...(storeSnapshotPort ? { storeSnapshotPort } : {}),
  ...(playerDevelopmentPort ? { playerDevelopmentPort } : {}),
  ...(clubEconomySettlementPort ? { clubEconomySettlementPort } : {}),
  ...(clubManagementPort ? { clubManagementPort } : {}),
  ...(specialAcquisitionPort ? { specialAcquisitionPort } : {}),
  ...(giftCodeRedemptionPort ? { giftCodeRedemptionPort } : {}),
  ...(botRuntimeLeasePort ? { botRuntimeLeasePort } : {}),
  ...(matchPorts ? { matchPorts } : {}),
  ...(supabaseHttp ? { supabaseHttpClient: supabaseHttp } : {}),
  ...(gameDashboardPort ? { gameDashboardPort } : {}),
  ...(walletReadPort ? { walletReadPort } : {}),
  ...(clubLineupPort ? { clubLineupPort } : {}),
  ...(publicPlayerRecordRepository ? { publicPlayerRecordRepository } : {}),
  ...(publicClubLogoRepository ? { publicClubLogoRepository } : {}),
  ...(publicClubReadRepository ? { publicClubReadRepository } : {}),
  ...(seasonAwardRepository ? { seasonAwardRepository } : {}),
  ...(telegramMessageDeletionPort ? { telegramMessageDeletionPort } : {}),
  ...(matchNotificationPort ? { matchNotificationPort } : {}),
  ...(adminGroupBroadcastPort ? { adminGroupBroadcastPort } : {}),
  ...(adminRoleLookupPort ? { adminRoleLookupPort } : {}),
  ...(adminConfigurationPort ? { adminConfigurationPort } : {}),
  ...(adminCatalogActionPort ? { adminCatalogActionPort } : {}),
  ...(adminEntityUpdatePort ? { adminEntityUpdatePort } : {}),
  ...(adminConsoleReadPort ? { adminConsoleReadPort } : {}),
  ...(adminModerationActionPort ? { adminModerationActionPort } : {}),
  ...(adminFinancialAdjustmentPort ? { adminFinancialAdjustmentPort } : {}),
  ...(adminBroadcastRetryPort ? { adminBroadcastRetryPort } : {}),
  ...(adminSeasonAwardActionPort ? { adminSeasonAwardActionPort } : {}),
  ...(adminBroadcastCreatePort ? { adminBroadcastCreatePort } : {}),
  ...(adminPyramidLeagueReadPort ? { adminPyramidLeagueReadPort } : {}),
  ...(adminPyramidLeagueReportsPort ? { adminPyramidLeagueReportsPort } : {}),
  ...(adminPyramidLeagueActionsPort ? { adminPyramidLeagueActionsPort } : {}),
  ...(eventTournamentSettlementPort ? { eventTournamentSettlementPort } : {}),
  ...(eventTournamentReadPort ? { eventTournamentReadPort } : {}),
  ...(pyramidLeagueSettlementPort ? { pyramidLeagueSettlementPort } : {}),
});
let matchWorker: NodeJS.Timeout | undefined;
let workerTask: Promise<void> | null = null;
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Football Empire API is shutting down");
  if (matchWorker) clearInterval(matchWorker);
  if (workerTask) await workerTask;
  await app.close();
}
process.once("SIGTERM", () => { void shutdown("SIGTERM").catch((error) => { app.log.error(error); process.exitCode = 1; }); });
process.once("SIGINT", () => { void shutdown("SIGINT").catch((error) => { app.log.error(error); process.exitCode = 1; }); });
try {
  await app.listen({ port, host });
  app.log.info({ host, port }, "Football Empire API is running");
  let workerRunning = false;
  matchWorker = setInterval(() => {
    if (workerRunning || shuttingDown) return;
    workerRunning = true;
    const runWorkerTick = async () => {
      const now = new Date();
      // Keep each durable subsystem independent: a broken match runtime must
      // not prevent pyramid promotions or completed event tournaments retrying.
      try {
        const result = await processDueMatchRuntimes("api-match-worker", now, 10);
        if (result.advanced || result.settled || result.failed) app.log.info({ matchRuntime: result }, "Match runtime worker tick");
      } catch (error) {
        app.log.error({ error }, "Match runtime worker failed");
      }
      try {
        const promotions = await processDuePromotionOffers(now, 50);
        if (promotions.accepted || promotions.completedLeagues || promotions.failed) app.log.info({ promotions }, "Pyramid league worker tick");
      } catch (error) {
        app.log.error({ error }, "Pyramid league worker failed");
      }
      if (matchPorts) {
        try {
          const tournaments = await processDueEventTournamentFinalizations(now, 10);
          if (tournaments.finalized || tournaments.failed) app.log.info({ tournaments }, "Event tournament worker tick");
        } catch (error) {
          app.log.error({ error }, "Event tournament worker failed");
        }
      }
    };
    workerTask = (matchPorts
      ? withNodeSupabaseMatchPorts(matchPorts, async () =>
          withEventTournamentSettlementPort(eventTournamentSettlementPort!, async () =>
            withPyramidLeagueSettlementPort(pyramidLeagueSettlementPort!, runWorkerTick)))
      : runWorkerTick())
      .catch((error: unknown) => app.log.error({ error }, "Game worker tick failed"))
      .finally(() => { workerRunning = false; workerTask = null; });
  }, 5_000);
  matchWorker.unref();
}
catch (error) { app.log.error(error); process.exit(1); }
