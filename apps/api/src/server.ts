import "dotenv/config";
import { buildApp } from "./app.js";
import { processDueMatchRuntimes } from "./game/match-service.js";
import { processDuePromotionOffers } from "./game/league-pyramid-service.js";
import { prisma } from "./db.js";
import { NodeSupabaseGroupMembershipRepository } from "./groups/node-supabase-group-membership.js";
import { NodeSupabaseAllianceRepository } from "./groups/node-supabase-alliance.js";
import { NodeSupabaseTelegramUserLookupRepository } from "./auth/node-supabase-telegram-user-lookup.js";
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
import { isValidTelegramBotToken, parseAdminTelegramIds, parseCorsOrigins } from "./runtime-config.js";
const required = ["DATABASE_URL", "TELEGRAM_BOT_TOKEN", "BOT_API_SECRET", "CORS_ORIGIN", "GAME_ADMIN_TELEGRAM_IDS"] as const;
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) throw new Error("Missing required runtime configuration: " + missing.join(", "));
if ((process.env.BOT_API_SECRET ?? "").length < 32 || /^(replace-with|change-me|your-)/i.test(process.env.BOT_API_SECRET ?? "")) throw new Error("BOT_API_SECRET must be a unique random secret of at least 32 characters; replace the example value.");
if (!isValidTelegramBotToken(process.env.TELEGRAM_BOT_TOKEN ?? "")) throw new Error("TELEGRAM_BOT_TOKEN does not look like a valid BotFather token.");
const adminIds = parseAdminTelegramIds(process.env.GAME_ADMIN_TELEGRAM_IDS);
if (!adminIds.length) throw new Error("GAME_ADMIN_TELEGRAM_IDS must contain at least one numeric Telegram user ID.");
if (!(process.env.DATABASE_URL?.startsWith("postgres://") || process.env.DATABASE_URL?.startsWith("postgresql://"))) throw new Error("DATABASE_URL must use PostgreSQL.");
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
const playerDevelopmentPort = supabaseHttp ? new SupabasePlayerDevelopmentRepository(supabaseHttp) : undefined;
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
const app = buildApp({
  ...(groupMembershipPort ? { groupMembershipPort } : {}),
  ...(alliancePort ? { alliancePort, adminAlliancePort: alliancePort } : {}),
  ...(telegramUserLookupPort ? { telegramUserLookupPort } : {}),
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
  ...(gameDashboardPort ? { gameDashboardPort } : {}),
  ...(walletReadPort ? { walletReadPort } : {}),
  ...(clubLineupPort ? { clubLineupPort } : {}),
  ...(publicPlayerRecordRepository ? { publicPlayerRecordRepository } : {}),
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
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  await app.listen({ port, host });
  app.log.info({ host, port }, "Football Empire API is running");
  let workerRunning = false;
  matchWorker = setInterval(() => {
    if (workerRunning || shuttingDown) return;
    workerRunning = true;
    workerTask = (matchPorts
      ? withNodeSupabaseMatchPorts(matchPorts, async () => {
          const result = await processDueMatchRuntimes("api-match-worker", new Date(), 10);
          const promotions = await processDuePromotionOffers(new Date(), 50);
          if (result.advanced || result.settled || result.failed || promotions.accepted || promotions.completedLeagues) app.log.info({ ...result, promotions }, "Game worker tick");
        })
      : processDueMatchRuntimes("api-match-worker", new Date(), 10).then(async (result) => {
          const promotions = await processDuePromotionOffers(new Date(), 50);
          if (result.advanced || result.settled || result.failed || promotions.accepted || promotions.completedLeagues) app.log.info({ ...result, promotions }, "Game worker tick");
        }))
      .catch((error: unknown) => app.log.error({ error }, "Match runtime worker failed"))
      .finally(() => { workerRunning = false; workerTask = null; });
  }, 5_000);
  matchWorker.unref();
}
catch (error) { app.log.error(error); await prisma.$disconnect(); process.exit(1); }
