import { createPrismaClient, withPrismaClient } from "../../../apps/api/src/db.js";
import { withWalletEntryPort } from "../../../apps/api/src/economy/wallet-entry-context.js";
import { withStorePurchasePort } from "../../../apps/api/src/store/store-purchase-context.js";
import { withStoreSnapshotPort } from "../../../apps/api/src/store/store-snapshot-context.js";
import { withStoreItemUsePort } from "../../../apps/api/src/store/store-item-use-context.js";
import { withMarketPurchasePort } from "../../../apps/api/src/players/market-purchase-context.js";
import { withGiftCodeRedemptionPort } from "../../../apps/api/src/gift-code-redemption-context.js";
import { withSpecialAcquisitionPort } from "../../../apps/api/src/players/special-acquisition-context.js";
import { withMarketListingPort } from "../../../apps/api/src/players/market-listing-context.js";
import { processDueMatchRuntimes } from "../../../apps/api/src/game/match-service.js";
import { processDueEventTournamentFinalizations } from "../../../apps/api/src/event-tournament-service.js";
import { processDuePromotionOffers } from "../../../apps/api/src/game/league-pyramid-service.js";
import { isValidTelegramBotToken, parseAdminTelegramIds, parseCorsOrigins } from "../../../apps/api/src/runtime-config.js";
import { createWorkersApiRouter } from "./workers-router.js";
import { SupabaseHttpClient } from "./supabase-http.js";
import { SupabasePilotAnalyticsRepository } from "./repositories/pilot-analytics.js";
import { SupabaseRuntimeReadinessRepository } from "./repositories/runtime-readiness.js";
import { SupabasePublicPlayerRecordRepository } from "./repositories/public-player-records.js";
import { SupabaseSeasonAwardRepository } from "./repositories/season-awards.js";
import { SupabaseWalletEntryRepository } from "./repositories/wallet-entry.js";
import { SupabaseStorePurchaseRepository } from "./repositories/store-purchase.js";
import { SupabaseStoreSnapshotRepository } from "./repositories/store-snapshot.js";
import { SupabaseStoreItemUseRepository } from "./repositories/store-item-use.js";
import { SupabaseMarketPurchaseRepository } from "./repositories/market-purchase.js";
import { SupabaseGiftCodeRedemptionRepository } from "./repositories/gift-code-redemption.js";
import { SupabaseSpecialAcquisitionRepository } from "./repositories/special-acquisition.js";
import { SupabaseMarketListingRepository } from "./repositories/market-listing.js";
import { SupabaseSpecialPlayerCatalogRepository } from "./repositories/special-player-catalog.js";
import { withMatchRuntimeLeasePort } from "../../../apps/api/src/game/match-runtime-lease-context.js";
import { withMatchOpponentPort } from "../../../apps/api/src/game/match-opponents-context.js";
import { withFriendlyMatchCreationPort } from "../../../apps/api/src/game/friendly-match-creation-context.js";
import { withCompetitionCreationPort } from "../../../apps/api/src/game/competition-creation-context.js";
import { withClubMatchReadPort } from "../../../apps/api/src/game/club-match-read-context.js";
import { withCompetitionAdvancementPort } from "../../../apps/api/src/game/competition-advancement-context.js";
import { SupabaseMatchOpponentRepository } from "./repositories/match-opponents.js";
import { SupabaseFriendlyMatchCreationRepository } from "./repositories/friendly-match-creation.js";
import { SupabaseCompetitionCreationRepository } from "./repositories/competition-creation.js";
import { SupabaseClubMatchReadRepository } from "./repositories/club-match-read.js";
import { SupabaseCompetitionAdvancementRepository } from "./repositories/competition-advancement.js";
import { withMatchRuntimeAdvancePort } from "../../../apps/api/src/game/match-runtime-advance-context.js";
import { withMatchRuntimeCheckpointPort } from "../../../apps/api/src/game/match-runtime-checkpoint-context.js";
import { withMatchRuntimeSettlementPort } from "../../../apps/api/src/game/match-runtime-settlement-context.js";
import { withMatchRuntimeEnqueuePort } from "../../../apps/api/src/game/match-runtime-enqueue-context.js";
import { SupabaseMatchRuntimeEnqueueRepository } from "./repositories/match-runtime-enqueue.js";
import { SupabaseMatchRuntimeAdvanceRepository } from "./repositories/match-runtime-advance.js";
import { SupabaseMatchRuntimeCheckpointRepository } from "./repositories/match-runtime-checkpoint.js";
import { SupabaseMatchRuntimeSettlementRepository } from "./repositories/match-runtime-settlement.js";
import { SupabaseMatchRuntimeLeaseRepository } from "./repositories/match-runtime-lease.js";
import { SupabaseMatchNotificationRepository, type MatchNotificationRow, type MatchNotificationPerformance } from "./repositories/match-notifications.js";
import { withGameDashboardPort } from "../../../apps/api/src/game/game-dashboard-context.js";
import { SupabaseGameDashboardRepository } from "./repositories/game-dashboard.js";
import { withTelegramUserLookupPort } from "../../../apps/api/src/auth/telegram-user-lookup-context.js";
import { SupabaseTelegramUserLookupRepository } from "./repositories/telegram-user-lookup.js";
import { withTelegramAccountProvisioningPort } from "../../../apps/api/src/auth/account-provisioning-context.js";
import { SupabaseTelegramAccountProvisioningRepository } from "./repositories/telegram-account-provisioning.js";
import { withClubTicketPricePort } from "../../../apps/api/src/game/club-ticket-price-context.js";
import { withClubEconomySettlementPort } from "../../../apps/api/src/game/club-economy-settlement-context.js";
import { withClubManagementPort } from "../../../apps/api/src/game/club-management-context.js";
import { SupabaseClubManagementRepository } from "./repositories/club-management.js";
import { withClubLineupPort } from "../../../apps/api/src/game/club-lineup-context.js";
import { SupabaseClubLineupRepository } from "./repositories/club-lineup.js";
import { withPlayerDevelopmentPort } from "../../../apps/api/src/players/player-development-context.js";
import { SupabasePlayerDevelopmentRepository } from "./repositories/player-development.js";
import { SupabaseClubEconomySettlementRepository } from "./repositories/club-economy-settlement.js";
import { SupabaseClubTicketPriceRepository } from "./repositories/club-ticket-price.js";

interface MatchCoordinatorNamespace { idFromName(name: string): unknown; get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> }; }
interface MatchCoordinatorState { storage: { setAlarm(scheduledTime: number): Promise<void>; deleteAlarm(): Promise<void>; }; }
interface Env {
  MATCH_COORDINATOR?: MatchCoordinatorNamespace; DATABASE_URL?: string;
  SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string; BOT_API_SECRET?: string; CORS_ORIGIN?: string; GAME_ADMIN_TELEGRAM_IDS?: string;
  ALLIANCE_REVIEWER_TELEGRAM_IDS?: string; GAME_ADMIN_ROLE_MAP?: string; ENVIRONMENT?: string;
}
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
function dbUrl(env: Env): string | null { return env.DATABASE_URL ?? null; }
function missingConfig(env: Env): string[] {
  const missing: string[] = [];
  const database = dbUrl(env);
  if (!database) missing.push("DATABASE_URL");
  else if (!/^postgres(?:ql)?:\/\//i.test(database)) missing.push("DATABASE_URL_INVALID");
  else if (env.ENVIRONMENT !== "development") {
    try {
      const parsed = new URL(database);
      if (!(parsed.hostname.endsWith(".pooler.supabase.com") && parsed.port === "6543")) {
        missing.push("DATABASE_URL_MUST_USE_SUPABASE_TRANSACTION_POOLER");
      }
    } catch { missing.push("DATABASE_URL_INVALID"); }
  }
  if (!isValidTelegramBotToken(env.TELEGRAM_BOT_TOKEN ?? "")) missing.push("TELEGRAM_BOT_TOKEN");
  if (!env.BOT_API_SECRET || env.BOT_API_SECRET.length < 32 || /^(replace-with|change-me|your-)/i.test(env.BOT_API_SECRET)) missing.push("BOT_API_SECRET");
  if (!parseAdminTelegramIds(env.GAME_ADMIN_TELEGRAM_IDS).length) missing.push("GAME_ADMIN_TELEGRAM_IDS");
  try {
    const production = env.ENVIRONMENT !== "development";
    const origins = parseCorsOrigins(env.CORS_ORIGIN, production);
    if (!origins.length) missing.push("CORS_ORIGIN");
    if (!production && origins.some((origin) => {
      const parsed = new URL(origin);
      return parsed.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    })) missing.push("CORS_ORIGIN_INVALID");
  } catch { missing.push("CORS_ORIGIN_INVALID"); }
  return missing;
}
function configureEnv(env: Env): void {
  process.env.ENVIRONMENT = env.ENVIRONMENT ?? "production";
  process.env.DATABASE_URL = dbUrl(env) ?? "";
  process.env.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN ?? "";
  process.env.BOT_API_SECRET = env.BOT_API_SECRET ?? "";
  process.env.CORS_ORIGIN = env.CORS_ORIGIN ?? "";
  process.env.GAME_ADMIN_TELEGRAM_IDS = env.GAME_ADMIN_TELEGRAM_IDS ?? "";
  process.env.ALLIANCE_REVIEWER_TELEGRAM_IDS = env.ALLIANCE_REVIEWER_TELEGRAM_IDS ?? "";
  process.env.GAME_ADMIN_ROLE_MAP = env.GAME_ADMIN_ROLE_MAP ?? "";
}
function shouldWakeMatchCoordinator(method: string, pathname: string): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) return false;
  return pathname === "/v1/matches/friendly"
    || /^\/v1\/matches\/[^/]+\/simulate$/.test(pathname)
    || /^\/v1\/matches\/[^/]+\/checkpoints\/[^/]+\/decisions$/.test(pathname)
    || pathname === "/v1/competitions"
    || /^\/v1\/competitions\/[^/]+\/(join|start)$/.test(pathname)
    || pathname === "/v1/friendly-challenges"
    || /^\/v1\/friendly-challenges\/[^/]+\/accept$/.test(pathname)
    || pathname === "/v1/pyramid-leagues/apply"
    || /^\/v1\/pyramid-leagues\/promotions\/[^/]+\/respond$/.test(pathname)
    || /^\/v1\/event-tournaments\/[^/]+\/join$/.test(pathname);
}

const allowedPilotEvents = new Set(["bot_start", "bot_command", "bot_callback", "bot_update", "miniapp_session"]);
function constantTimeSecretEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (!a.length || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i]! ^ b[i]!;
  return mismatch === 0;
}


async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const missing = missingConfig(env);
  if (missing.length) return json({ status: "not_ready", service: "football-empire-cloudflare-api", missing }, 503);
  let client: ReturnType<typeof createPrismaClient>;
  try { client = createPrismaClient(dbUrl(env) ?? undefined, 1); }
  catch { return json({ status: "not_ready", service: "football-empire-cloudflare-api", missing: ["DATABASE_CONFIGURATION"] }, 503); }
  let cleanupScheduled = false;
  try {
    const response = await withPrismaClient(client, () => {
      const supabaseClient = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
        ? new SupabaseHttpClient({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY })
        : undefined;
      const publicPlayerRecords = supabaseClient ? new SupabasePublicPlayerRecordRepository(supabaseClient) : undefined;
      const gameDashboard = supabaseClient ? new SupabaseGameDashboardRepository(supabaseClient) : undefined;
      const telegramUserLookup = supabaseClient ? new SupabaseTelegramUserLookupRepository(supabaseClient) : undefined;
      const telegramAccountProvisioning = supabaseClient ? new SupabaseTelegramAccountProvisioningRepository(supabaseClient) : undefined;
      const clubTicketPrice = supabaseClient ? new SupabaseClubTicketPriceRepository(supabaseClient) : undefined;
      const clubEconomySettlement = supabaseClient ? new SupabaseClubEconomySettlementRepository(supabaseClient) : undefined;
      const clubManagement = supabaseClient ? new SupabaseClubManagementRepository(supabaseClient) : undefined;
      const clubLineup = supabaseClient ? new SupabaseClubLineupRepository(supabaseClient) : undefined;
      const playerDevelopment = supabaseClient ? new SupabasePlayerDevelopmentRepository(supabaseClient) : undefined;
      const seasonAwards = supabaseClient ? new SupabaseSeasonAwardRepository(supabaseClient) : undefined;
      const walletEntry = supabaseClient ? new SupabaseWalletEntryRepository(supabaseClient) : undefined;
      const storePurchase = supabaseClient ? new SupabaseStorePurchaseRepository(supabaseClient) : undefined;
      const storeSnapshot = supabaseClient ? new SupabaseStoreSnapshotRepository(supabaseClient) : undefined;
      const storeItemUse = supabaseClient ? new SupabaseStoreItemUseRepository(supabaseClient) : undefined;
      const marketPurchase = supabaseClient ? new SupabaseMarketPurchaseRepository(supabaseClient) : undefined;
      const giftCodeRedemption = supabaseClient ? new SupabaseGiftCodeRedemptionRepository(supabaseClient) : undefined;
      const specialAcquisition = supabaseClient ? new SupabaseSpecialAcquisitionRepository(supabaseClient) : undefined;
      const marketListing = supabaseClient ? new SupabaseMarketListingRepository(supabaseClient) : undefined;
      const specialPlayers = supabaseClient ? new SupabaseSpecialPlayerCatalogRepository(supabaseClient) : undefined;
      const matchRuntimeCheckpoint = supabaseClient ? new SupabaseMatchRuntimeCheckpointRepository(supabaseClient) : undefined;
      const matchOpponents = supabaseClient ? new SupabaseMatchOpponentRepository(supabaseClient) : undefined;
      const friendlyMatchCreation = supabaseClient ? new SupabaseFriendlyMatchCreationRepository(supabaseClient) : undefined;
      const competitionCreation = supabaseClient ? new SupabaseCompetitionCreationRepository(supabaseClient) : undefined;
      const clubMatchRead = supabaseClient ? new SupabaseClubMatchReadRepository(supabaseClient) : undefined;
      const competitionAdvancement = supabaseClient ? new SupabaseCompetitionAdvancementRepository(supabaseClient) : undefined;
      const matchRuntimeSettlement = supabaseClient ? new SupabaseMatchRuntimeSettlementRepository(supabaseClient) : undefined;
      const router = createWorkersApiRouter({ publicPlayerRecords, seasonAwards, specialPlayers });
      const handle = async (): Promise<Response> => await router.fetch(request);
      const withCompetitionCreation = competitionCreation ? () => withCompetitionCreationPort(competitionCreation, handle) : handle;
      const withClubMatchRead = clubMatchRead ? () => withClubMatchReadPort(clubMatchRead, withCompetitionCreation) : withCompetitionCreation;
      const withCompetitionAdvancement = competitionAdvancement ? () => withCompetitionAdvancementPort(competitionAdvancement, withClubMatchRead) : withClubMatchRead;
      const withFriendlyMatchCreation = friendlyMatchCreation ? () => withFriendlyMatchCreationPort(friendlyMatchCreation, withCompetitionAdvancement) : withCompetitionAdvancement;
      const withMatchOpponents = matchOpponents ? () => withMatchOpponentPort(matchOpponents, withFriendlyMatchCreation) : withFriendlyMatchCreation;
      const withDashboard = gameDashboard ? () => withGameDashboardPort(gameDashboard, withMatchOpponents) : withMatchOpponents;
      const withTelegramUserLookup = telegramUserLookup ? () => withTelegramUserLookupPort(telegramUserLookup, withDashboard) : withDashboard;
      const withTelegramAccountProvisioning = telegramAccountProvisioning
        ? () => withTelegramAccountProvisioningPort(telegramAccountProvisioning, withTelegramUserLookup) : withTelegramUserLookup;
      const withClubTicketPrice = clubTicketPrice ? () => withClubTicketPricePort(clubTicketPrice, withTelegramAccountProvisioning) : withTelegramAccountProvisioning;
      const withClubEconomy = clubEconomySettlement ? () => withClubEconomySettlementPort(clubEconomySettlement, withClubTicketPrice) : withClubTicketPrice;
      const withClubOperations = clubManagement ? () => withClubManagementPort(clubManagement, withClubEconomy) : withClubEconomy;
      const withLineup = clubLineup ? () => withClubLineupPort(clubLineup, withClubOperations) : withClubOperations;
      const withPlayerDevelopment = playerDevelopment ? () => withPlayerDevelopmentPort(playerDevelopment, withLineup) : withLineup;
      const withCheckpoint = matchRuntimeCheckpoint
        ? () => withMatchRuntimeCheckpointPort(matchRuntimeCheckpoint, withPlayerDevelopment) : withPlayerDevelopment;
      const withSettlement = matchRuntimeSettlement
        ? () => withMatchRuntimeSettlementPort(matchRuntimeSettlement, withCheckpoint) : withCheckpoint;
      const withWallet = walletEntry ? () => withWalletEntryPort(walletEntry, withSettlement) : withSettlement;
      const withStorePurchase = storePurchase ? () => withStorePurchasePort(storePurchase, withWallet) : withWallet;
      const withMarketPurchase = marketPurchase ? () => withMarketPurchasePort(marketPurchase, withStorePurchase) : withStorePurchase;
      const withGiftCodeRedemption = giftCodeRedemption ? () => withGiftCodeRedemptionPort(giftCodeRedemption, withMarketPurchase) : withMarketPurchase;
      const withSpecialAcquisition = specialAcquisition ? () => withSpecialAcquisitionPort(specialAcquisition, withGiftCodeRedemption) : withGiftCodeRedemption;
      const withMarketListing = marketListing ? () => withMarketListingPort(marketListing, withSpecialAcquisition) : withSpecialAcquisition;
      const withStoreRead = storeSnapshot ? () => withStoreSnapshotPort(storeSnapshot, withMarketListing) : withMarketListing;
      return storeItemUse ? withStoreItemUsePort(storeItemUse, withStoreRead) : withStoreRead();
    });
    cleanupScheduled = true;
    ctx.waitUntil(client.$disconnect().catch((error: unknown) => console.error("Prisma request client cleanup failed", error)));
    return response;
  } catch (error) {
    console.error("Cloudflare API request failed", describeRuntimeError(error));
    return json({ error: "INTERNAL_SERVER_ERROR" }, 500);
  } finally {
    if (!cleanupScheduled) await client.$disconnect().catch(() => undefined);
  }
}
export class MatchCoordinator {
  constructor(private readonly state: MatchCoordinatorState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/ensure") return json({ error: "NOT_FOUND" }, 404);
    await this.state.storage.setAlarm(Date.now() + 1_000);
    return json({ scheduled: true });
  }

  async alarm(): Promise<void> {
    const missing = missingConfig(this.env);
    if (missing.length) {
      console.error("Match coordinator paused; missing configuration:", missing);
      await this.state.storage.deleteAlarm();
      return;
    }
    const client = createPrismaClient(dbUrl(this.env) ?? undefined, 1);
    let nextAlarm: number | null = null;
    try {
      await withPrismaClient(client, async () => {
        const supabase = this.env.SUPABASE_URL && this.env.SUPABASE_SERVICE_ROLE_KEY
          ? new SupabaseHttpClient({ url: this.env.SUPABASE_URL, serviceRoleKey: this.env.SUPABASE_SERVICE_ROLE_KEY })
          : undefined;
        const matchRuntimeLease = supabase ? new SupabaseMatchRuntimeLeaseRepository(supabase) : undefined;
        const matchRuntimeEnqueue = supabase ? new SupabaseMatchRuntimeEnqueueRepository(supabase) : undefined;
        const matchRuntimeAdvance = supabase ? new SupabaseMatchRuntimeAdvanceRepository(supabase) : undefined;
        const matchRuntimeCheckpoint = supabase ? new SupabaseMatchRuntimeCheckpointRepository(supabase) : undefined;
        const matchRuntimeSettlement = supabase ? new SupabaseMatchRuntimeSettlementRepository(supabase) : undefined;
        const matchNotifications = supabase ? new SupabaseMatchNotificationRepository(supabase) : undefined;
        const now = new Date();
        // One indexed scheduler statement replaces six independent findFirst queries.
        // Its flags also let us skip queue scans and workers that have no due work.
        if (!matchRuntimeLease || !matchRuntimeEnqueue || !matchRuntimeAdvance || !matchRuntimeCheckpoint || !matchRuntimeSettlement || !competitionAdvancement) throw new Error("SUPABASE_MATCH_RUNTIME_REPOSITORY_UNAVAILABLE");
        const schedule = await matchRuntimeLease.getSchedule();
        const runMatchWork = () => withCompetitionAdvancementPort(competitionAdvancement, () =>
          withMatchRuntimeEnqueuePort(matchRuntimeEnqueue, () =>
            withMatchRuntimeAdvancePort(matchRuntimeAdvance, () =>
              withMatchRuntimeCheckpointPort(matchRuntimeCheckpoint, () =>
                withMatchRuntimeSettlementPort(matchRuntimeSettlement, () =>
                processDueMatchRuntimes("cloudflare-match-coordinator", now, 10, {
                  enqueue: schedule.hasDueFixture,
                  claim: schedule.hasDueRuntime || schedule.hasDueFixture,
                }))))));
        const matchWork = await withMatchRuntimeLeasePort(matchRuntimeLease, runMatchWork);
        const tournamentFinalizations = schedule.hasPendingTournamentFinalization
          ? await processDueEventTournamentFinalizations(now, 1)
          : { candidates: 0, finalized: 0, failed: 0 };
        if (schedule.hasDueNotifications) {
          if (!matchNotifications) throw new Error("SUPABASE_MATCH_NOTIFICATION_REPOSITORY_UNAVAILABLE");
          await deliverDueMatchLifecycle(this.env, matchNotifications);
        }
        if (schedule.hasPendingPromotionWork) {
          const promotions = await processDuePromotionOffers(now, 50);
          if (promotions.completedLeagues || promotions.accepted) console.info("Pyramid promotion work completed", promotions);
        }
        if (matchWork.failed) console.warn("Match runtime work failed", matchWork);
        if (tournamentFinalizations.failed) console.error("Tournament finalization retries remain pending", tournamentFinalizations);
        nextAlarm = schedule.nextAlarm?.getTime() ?? null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const quotaLimited = /Usage limit for account exceeded/i.test(message);
      console.error("Match coordinator tick failed", describeRuntimeError(error));
      if (quotaLimited) {
        const now = new Date();
        nextAlarm = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 5);
      } else nextAlarm = Date.now() + 60_000;
    } finally {
      await client.$disconnect();
    }
    if (nextAlarm === null) await this.state.storage.deleteAlarm();
    else await this.state.storage.setAlarm(Math.max(Date.now() + 1_000, nextAlarm));
  }
}

function describeRuntimeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error, message: String(error).slice(0, 600) };
  const candidate = error as Error & { code?: unknown; meta?: unknown };
  const redact = (value: unknown) => String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted-database-url]")
    .slice(0, 800);
  const meta = candidate.meta && typeof candidate.meta === "object"
    ? Object.fromEntries(Object.entries(candidate.meta as Record<string, unknown>)
      .filter(([key, value]) => ["modelName", "table", "column", "constraint", "code", "field_name"].includes(key)
        && (typeof value === "string" || typeof value === "number" || typeof value === "boolean"))
      .map(([key, value]) => [key, redact(value)]))
    : undefined;
  return {
    name: error.name,
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    message: redact(error.message),
    ...(meta && Object.keys(meta).length ? { meta } : {}),
  };
}

function escapeTelegramHtml(value: unknown): string { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
async function deliverDueMatchLifecycle(env: Env, repository: SupabaseMatchNotificationRepository): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token) return;
  const rows = await repository.claimDue(50, 30);
  for (const row of rows) {
    let delivered = false;
    let errorCode = "TELEGRAM_SEND_FAILED";
    try {
      const message = row.type === "LIFECYCLE" ? formatLifecycleNotification(row) : formatResultNotification(row);
      const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: row.telegramChatId, text: message, parse_mode: "HTML" }),
      });
      const body = await response.json() as { ok?: boolean; description?: string };
      delivered = response.ok && body.ok === true;
      if (!delivered && body.description) errorCode = body.description.slice(0, 500);
    } catch (error) {
      errorCode = error instanceof Error ? error.message.slice(0, 500) : errorCode;
    }
    await repository.complete(row.type, row.id, row.claimToken, delivered, delivered ? null : errorCode, 15);
  }
}
function formatLifecycleNotification(row: MatchNotificationRow): string {
  const home = escapeTelegramHtml(row.homeClubName ?? "میزبان");
  const away = escapeTelegramHtml(row.awayClubName ?? "میهمان");
  const score = "\n<b>" + home + "</b> " + (row.homeScore ?? 0) + " : " + (row.awayScore ?? 0) + " <b>" + away + "</b>";
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return row.kind === "KICKOFF" ? "⚽ <b>سوت آغاز مسابقه</b>" + score
    : row.kind === "HALF_TIME" ? "⏸ <b>پایان نیمه اول</b> · دقیقه ۴۵" + score
    : "⚽ <b>گل!</b> · دقیقه " + row.minute + "\n" + escapeTelegramHtml(payload.teamName ?? "تیم") + " · " + escapeTelegramHtml(payload.scorerName ?? "بازیکن") + score;
}
function formatResultNotification(row: MatchNotificationRow): string {
  const performances = row.performances ?? [];
  const home = performances.filter((line) => line.clubId === row.homeClubId);
  const away = performances.filter((line) => line.clubId === row.awayClubId);
  const sum = (items: MatchNotificationPerformance[], key: "shots" | "passes" | "tackles") => items.reduce((total, item) => total + item[key], 0);
  const scorers = performances.filter((line) => line.goals > 0).sort((a, b) => b.goals - a.goals)
    .map((line) => escapeTelegramHtml(line.playerName) + " · " + line.goals + " گل").join("\n");
  return "🏁 <b>پایان مسابقه</b>\n<b>" + escapeTelegramHtml(row.homeClubName ?? "میزبان") + "</b> " + (row.homeScore ?? 0)
    + " : " + (row.awayScore ?? 0) + " <b>" + escapeTelegramHtml(row.awayClubName ?? "میهمان") + "</b>"
    + "\n\n📊 <b>آمار مسابقه</b>"
    + "\nشوت‌ها: " + sum(home, "shots") + " - " + sum(away, "shots")
    + "\nپاس‌ها: " + sum(home, "passes") + " - " + sum(away, "passes")
    + "\nتکل‌ها: " + sum(home, "tackles") + " - " + sum(away, "tackles")
    + (scorers ? "\n\n⚽ <b>گلزنان</b>\n" + scorers : "\n\n⚽ بدون گل");
}

async function scheduledJobs(env: Env): Promise<void> {
  if (env.MATCH_COORDINATOR) {
    console.info("Scheduled fallback skipped; MatchCoordinator owns match and tournament processing.");
    return;
  }
  const missing = missingConfig(env);
  if (missing.length) { console.error("Scheduled game jobs skipped; missing configuration:", missing); return; }
  configureEnv(env);
  const client = createPrismaClient(dbUrl(env) ?? undefined, 1);
  try {
    await withPrismaClient(client, async () => {
      const now = new Date();
      const supabase = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
        ? new SupabaseHttpClient({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }) : undefined;
      const matchNotifications = supabase ? new SupabaseMatchNotificationRepository(supabase) : undefined;
      const matches = env.MATCH_COORDINATOR
        ? null
        : await processDueMatchRuntimes("cloudflare-api-scheduled-fallback", now, 10);
      const tournamentFinalizations = await processDueEventTournamentFinalizations(now, 1);
      if (!matchNotifications) throw new Error("SUPABASE_MATCH_NOTIFICATION_REPOSITORY_UNAVAILABLE");
      await deliverDueMatchLifecycle(env, matchNotifications);
      const promotions = await processDuePromotionOffers(now, 50);
      if ((matches && (matches.advanced || matches.settled || matches.failed))
        || tournamentFinalizations.finalized || tournamentFinalizations.failed
        || promotions.accepted || promotions.completedLeagues) {
        console.info("Cloudflare scheduled game tick", { matches, tournamentFinalizations, promotions });
      }
    });
  } finally { await client.$disconnect(); }
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", service: "football-empire-cloudflare-api", mode: "hono-prisma-runtime", build: "2026-11-16-hono-router-1" });
    }
    if (url.pathname === "/internal/pilot/events") {
      if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      const supplied = request.headers.get("x-football-bot-secret") ?? "";
      if (!env.BOT_API_SECRET || !constantTimeSecretEqual(supplied, env.BOT_API_SECRET)) return json({ error: "UNAUTHORIZED" }, 401);
      const length = Number(request.headers.get("content-length") ?? "0");
      if (Number.isFinite(length) && length > 4096) return json({ error: "PAYLOAD_TOO_LARGE" }, 413);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 4096) return json({ error: "PAYLOAD_TOO_LARGE" }, 413);
      let event: { eventName?: unknown; userKey?: unknown; actionKey?: unknown; chatType?: unknown; source?: unknown };
      try { event = JSON.parse(raw) as typeof event; } catch { return json({ error: "INVALID_JSON" }, 400); }
      if (typeof event.eventName !== "string" || !allowedPilotEvents.has(event.eventName)
        || typeof event.userKey !== "string" || !/^[a-f0-9]{32}$/.test(event.userKey)
        || (event.actionKey !== undefined && (typeof event.actionKey !== "string" || event.actionKey.length > 64 || !/^[a-z0-9_-]*$/i.test(event.actionKey)))
        || (event.chatType !== undefined && !["private", "group", "supergroup", "channel", "unknown"].includes(String(event.chatType)))
        || !["bot", "miniapp"].includes(String(event.source))) return json({ error: "INVALID_EVENT" }, 400);
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        return json({ error: "ANALYTICS_UNAVAILABLE" }, 503);
      }
      try {
        const analytics = new SupabasePilotAnalyticsRepository(
          new SupabaseHttpClient({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }),
        );
        await analytics.record({
          eventName: event.eventName,
          userKey: event.userKey,
          actionKey: typeof event.actionKey === "string" ? event.actionKey : "",
          chatType: typeof event.chatType === "string" ? event.chatType : "unknown",
          source: String(event.source),
        });
        return json({ accepted: true }, 202);
      } catch (error) {
        console.error("Pilot analytics persistence failed", describeRuntimeError(error));
        return json({ error: "ANALYTICS_UNAVAILABLE" }, 503);
      }
    }
    configureEnv(env);
    if (request.method === "OPTIONS") return createWorkersApiRouter().fetch(request);
    if (request.method === "GET" && url.pathname === "/ready") {
      const missing = missingConfig(env).filter((item) =>
        !["DATABASE_URL", "DATABASE_URL_INVALID", "DATABASE_URL_MUST_USE_SUPABASE_TRANSACTION_POOLER"].includes(item));
      if (!env.SUPABASE_URL) missing.push("SUPABASE_URL");
      if (!env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY.length < 32) missing.push("SUPABASE_SERVICE_ROLE_KEY");
      if (missing.length) return json({ status: "not_ready", service: "football-empire-cloudflare-api", missing }, 503);
      try {
        const supabase = new SupabaseHttpClient({
          url: env.SUPABASE_URL!,
          serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!,
        });
        const schemaReady = await new SupabaseRuntimeReadinessRepository(supabase).check();
        if (!schemaReady) {
          return json({
            status: "not_ready",
            service: "football-empire-cloudflare-api",
            database: "connected",
            database_transport: "supabase_https",
            missing: ["DATABASE_SCHEMA_MIGRATIONS"],
          }, 503);
        }
        return json({
          status: "ready",
          service: "football-empire-cloudflare-api",
          database: "connected",
          database_transport: "supabase_https",
          schema: "current",
        });
      } catch (error) {
        console.error("Cloudflare API Supabase readiness check failed", describeRuntimeError(error));
        return json({ status: "not_ready", service: "football-empire-cloudflare-api", missing: ["SUPABASE_DATABASE_CHECK"] }, 503);
      }
    }
    const response = await handleApi(request, env, ctx);
    if (env.MATCH_COORDINATOR && shouldWakeMatchCoordinator(request.method, url.pathname)) {
      const coordinator = env.MATCH_COORDINATOR.get(env.MATCH_COORDINATOR.idFromName("football-empire-match-runtime"));
      ctx.waitUntil(coordinator.fetch("https://match-coordinator/ensure", { method: "POST" }).catch((error: unknown) => {
        console.error("Could not schedule match coordinator alarm", error);
        return new Response(null, { status: 503 });
      }));
    }
    return response;
  },
  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(scheduledJobs(env).catch((error: unknown) => console.error("Cloudflare scheduled game jobs failed", describeRuntimeError(error))));
  },
};
