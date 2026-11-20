import Fastify from "fastify";
import { z } from "zod";
import { registerTelegramAuthRoutes } from "./auth/routes.js";
import type { TelegramUserLookupPort } from "./auth/telegram-user-lookup-context.js";
import { withTelegramUserLookupPort } from "./auth/telegram-user-lookup-context.js";
import { registerBotAuthRoutes } from "./auth/bot-routes.js";
import { registerGameRoutes } from "./game/routes.js";
import type { ClubLineupPort } from "./game/club-lineup-context.js";
import { withClubLineupPort } from "./game/club-lineup-context.js";
import { registerClubOperationsRoutes } from "./game/club-operations-routes.js";
import { registerPlayerMarketRoutes } from "./players/market-routes.js";
import { registerPlayerDevelopmentRoutes } from "./players/player-development-routes.js";
import { registerMatchRoutes } from "./game/match-routes.js";
import { registerMatchNotificationRoutes } from "./game/match-notification-routes.js";
import { registerGroupRoutes } from "./groups/group-routes.js";
import type { GroupMembershipPort } from "./groups/group-membership-context.js";
import { withGroupMembershipPort } from "./groups/group-membership-context.js";
import type { ActionRateLimitPort } from "./groups/action-rate-limit-context.js";
import { withActionRateLimitPort } from "./groups/action-rate-limit-context.js";
import { registerAllianceRoutes } from "./groups/alliance-routes.js";
import type { AlliancePort } from "./groups/alliance-context.js";
import { withAlliancePort } from "./groups/alliance-context.js";
import type { StorePurchasePort } from "./store/store-purchase-context.js";
import { withStorePurchasePort } from "./store/store-purchase-context.js";
import type { StoreItemUsePort } from "./store/store-item-use-context.js";
import { withStoreItemUsePort } from "./store/store-item-use-context.js";
import type { WalletEntryPort } from "./economy/wallet-entry-context.js";
import { withWalletEntryPort } from "./economy/wallet-entry-context.js";
import type { MarketListingPort } from "./players/market-listing-context.js";
import { withMarketListingPort } from "./players/market-listing-context.js";
import type { MarketPurchasePort } from "./players/market-purchase-context.js";
import { withMarketPurchasePort } from "./players/market-purchase-context.js";
import type { StoreSnapshotPort } from "./store/store-snapshot-context.js";
import { withStoreSnapshotPort } from "./store/store-snapshot-context.js";
import type { PlayerDevelopmentPort } from "./players/player-development-context.js";
import { withPlayerDevelopmentPort } from "./players/player-development-context.js";
import type { ClubEconomySettlementPort } from "./game/club-economy-settlement-context.js";
import { withClubEconomySettlementPort } from "./game/club-economy-settlement-context.js";
import { prisma } from "./db.js";
import { parseAdminTelegramIds, parseCorsOrigins } from "./runtime-config.js";
import { registerAdminRoutes } from "./admin-routes.js";
import type { AdminAlliancePort } from "./groups/node-supabase-alliance.js";
import { registerAdminLeagueRoutes } from "./admin-league-routes.js";
import { registerGiftCodeRoutes } from "./gift-code-routes.js";
import { registerTelegramMessageDeletionRoutes } from "./telegram-message-deletion-routes.js";
import { registerLeagueNoticeRoutes } from "./league-notice-routes.js";
import { registerAdminGroupBroadcastRoutes } from "./admin-group-broadcast-routes.js";
import { registerBotRuntimeRoutes } from "./bot-runtime-routes.js";
import { registerPublicClubRoutes } from "./public-club-routes.js";
import type { PublicClubLogoRepository } from "./node-supabase-public-club-logo.js";
import type { PublicClubReadRepository } from "./public-club-routes.js";
import { registerPublicPlayerRecordRoutes, type PublicPlayerRecordRepository } from "./players/public-record-routes.js";
import { registerSeasonAwardRoutes } from "./game/season-award-routes.js";
import { registerStoreRoutes } from "./store/store-routes.js";
import { registerEventTournamentRoutes } from "./event-tournament-routes.js";
import type { EventTournamentReadPort } from "./event-tournament-read-context.js";
import { withEventTournamentReadPort } from "./event-tournament-read-context.js";
import type { ClubManagementPort } from "./game/club-management-context.js";
import { withClubManagementPort } from "./game/club-management-context.js";
import type { SpecialAcquisitionPort } from "./players/special-acquisition-context.js";
import { withSpecialAcquisitionPort } from "./players/special-acquisition-context.js";
import type { GiftCodeRedemptionPort } from "./gift-code-redemption-context.js";
import { withGiftCodeRedemptionPort } from "./gift-code-redemption-context.js";
import type { EventTournamentSettlementPort } from "./event-tournament-settlement-context.js";
import { withEventTournamentSettlementPort } from "./event-tournament-settlement-context.js";
import type { BotRuntimeLeasePort } from "./bot-runtime-lease-context.js";
import type { NodeSupabaseMatchPorts } from "./game/node-supabase-match-ports.js";
import type { GameDashboardPort } from "./game/game-dashboard-context.js";
import type { WalletReadPort } from "./economy/wallet-read-context.js";
import { withWalletReadPort } from "./economy/wallet-read-context.js";
import { withGameDashboardPort } from "./game/game-dashboard-context.js";
import { withNodeSupabaseMatchPorts } from "./game/node-supabase-match-ports.js";

const healthResponse = z.object({
  status: z.literal("ok"),
  service: z.literal("football-empire-api"),
  version: z.string(),
});

export function buildApp(options: { logger?: boolean; pluginTimeout?: number; groupMembershipPort?: GroupMembershipPort; alliancePort?: AlliancePort; adminAlliancePort?: AdminAlliancePort; telegramUserLookupPort?: TelegramUserLookupPort; storePurchasePort?: StorePurchasePort; storeItemUsePort?: StoreItemUsePort; walletEntryPort?: WalletEntryPort; marketListingPort?: MarketListingPort; marketPurchasePort?: MarketPurchasePort; storeSnapshotPort?: StoreSnapshotPort; playerDevelopmentPort?: PlayerDevelopmentPort; clubEconomySettlementPort?: ClubEconomySettlementPort; clubManagementPort?: ClubManagementPort; specialAcquisitionPort?: SpecialAcquisitionPort; giftCodeRedemptionPort?: GiftCodeRedemptionPort; botRuntimeLeasePort?: BotRuntimeLeasePort; matchPorts?: NodeSupabaseMatchPorts; gameDashboardPort?: GameDashboardPort; walletReadPort?: WalletReadPort; clubLineupPort?: ClubLineupPort; publicPlayerRecordRepository?: PublicPlayerRecordRepository; publicClubLogoRepository?: PublicClubLogoRepository; publicClubReadRepository?: PublicClubReadRepository; eventTournamentSettlementPort?: EventTournamentSettlementPort; eventTournamentReadPort?: EventTournamentReadPort; actionRateLimitPort?: ActionRateLimitPort } = {}) {
  // The match service still contains Prisma compatibility paths for isolated legacy
  // tests and migration parity. Never allow production HTTP routes to reach those
  // paths: the complete direct-HTTPS Supabase match repository set is mandatory.
  if (process.env.NODE_ENV === "production" && !options.matchPorts) {
    throw new Error("SUPABASE_MATCH_PORTS_REQUIRED: production API must use direct Supabase HTTP repositories.");
  }
  const app = Fastify({{
    logger: options.logger ?? process.env.NODE_ENV !== "test",
    pluginTimeout: options.pluginTimeout ?? 10_000,
    requestIdHeader: "x-request-id",
    bodyLimit: 1_048_576,
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("pragma", "no-cache");
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if (process.env.NODE_ENV === "production") reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    return payload;
  });

  if (options.telegramUserLookupPort) {
    app.addHook("onRequest", (_request, _reply, done) => {
      void withTelegramUserLookupPort(options.telegramUserLookupPort!, async () => done());
    });
  }

  // Establish a per-request AsyncLocalStorage scope before route hooks/handlers run.
  // The callback-style hook is intentional: done() schedules Fastify's continuation
  // from inside the ALS scope, avoiding a global mutable repository singleton.
  if (options.groupMembershipPort) {
    app.addHook("onRequest", (_request, _reply, done) => {
      withGroupMembershipPort(options.groupMembershipPort!, () => done());
    });
  }

  if (options.actionRateLimitPort) {
    app.addHook("onRequest", (_request, _reply, done) => {
      withActionRateLimitPort(options.actionRateLimitPort!, () => done());
    });
  }

  if (options.alliancePort) {
    app.addHook("onRequest", (_request, _reply, done) => {
      void withAlliancePort(options.alliancePort!, async () => done());
    });
  }

  if (options.storePurchasePort) {
    app.addHook("onRequest", (_request, _reply, done) => {
      withStorePurchasePort(options.storePurchasePort!, () => done());
    });
  }
  if (options.storeItemUsePort) {
    app.addHook("onRequest", (_request, _reply, done) => {
      withStoreItemUsePort(options.storeItemUsePort!, () => done());
    });
  }

  if (options.walletEntryPort) app.addHook("onRequest", (_request, _reply, done) => withWalletEntryPort(options.walletEntryPort!, () => done()));
  if (options.marketListingPort) app.addHook("onRequest", (_request, _reply, done) => withMarketListingPort(options.marketListingPort!, () => done()));
  if (options.marketPurchasePort) app.addHook("onRequest", (_request, _reply, done) => withMarketPurchasePort(options.marketPurchasePort!, () => done()));
  if (options.storeSnapshotPort) app.addHook("onRequest", (_request, _reply, done) => withStoreSnapshotPort(options.storeSnapshotPort!, () => done()));
  if (options.playerDevelopmentPort) app.addHook("onRequest", (_request, _reply, done) => { void withPlayerDevelopmentPort(options.playerDevelopmentPort!, async () => { done(); }); });
  if (options.clubManagementPort) app.addHook("onRequest", (_request, _reply, done) => { void withClubManagementPort(options.clubManagementPort!, async () => done()); });
  if (options.specialAcquisitionPort) app.addHook("onRequest", (_request, _reply, done) => { void withSpecialAcquisitionPort(options.specialAcquisitionPort!, async () => done()); });
  if (options.giftCodeRedemptionPort) app.addHook("onRequest", (_request, _reply, done) => { void withGiftCodeRedemptionPort(options.giftCodeRedemptionPort!, async () => done()); });
  if (options.eventTournamentSettlementPort) app.addHook("onRequest", (_request, _reply, done) => { void withEventTournamentSettlementPort(options.eventTournamentSettlementPort!, async () => done()); });
  if (options.eventTournamentReadPort) app.addHook("onRequest", (_request, _reply, done) => { void withEventTournamentReadPort(options.eventTournamentReadPort!, async () => done()); });
  if (options.matchPorts) app.addHook("onRequest", (_request, _reply, done) => { void withNodeSupabaseMatchPorts(options.matchPorts!, async () => done()); });
  if (options.gameDashboardPort) app.addHook("onRequest", (_request, _reply, done) => { void withGameDashboardPort(options.gameDashboardPort!, async () => done()); });
  if (options.walletReadPort) app.addHook("onRequest", (_request, _reply, done) => { void withWalletReadPort(options.walletReadPort!, async () => done()); });
  if (options.clubLineupPort) app.addHook("onRequest", (_request, _reply, done) => { void withClubLineupPort(options.clubLineupPort!, async () => done()); });

  if (options.clubEconomySettlementPort) app.addHook("onRequest", (_request, _reply, done) => { void withClubEconomySettlementPort(options.clubEconomySettlementPort!, async () => { done(); }); });

  // Implement CORS with native Fastify hooks instead of @fastify/cors.
  // The plugin lifecycle can stall in the Cloudflare Workers runtime, preventing
  // app.ready() and every app.inject() request from completing.
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    let allowedOrigins: string[];
    try {
      allowedOrigins = parseCorsOrigins(process.env.CORS_ORIGIN);
    } catch {
      allowedOrigins = [];
    }
    const originAllowed = !origin || allowedOrigins.includes(origin);

    if (origin && originAllowed) {
      reply
        .header("access-control-allow-origin", origin)
        .header("access-control-allow-credentials", "true")
        .header("vary", "Origin");
    }

    if (request.method === "OPTIONS") {
      if (!originAllowed) return reply.code(403).send();
      const requestedHeaders = request.headers["access-control-request-headers"];
      reply
        .header("access-control-allow-methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS")
        .header("access-control-max-age", "86400");
      if (typeof requestedHeaders === "string" && requestedHeaders.length <= 2048) {
        reply.header("access-control-allow-headers", requestedHeaders);
      }
      return reply.code(204).send();
    }
  });

  app.get("/ready", async (request, reply) => {
    const missing = [
      ...(!process.env.DATABASE_URL ? ["DATABASE_URL"] : []),
      ...(!process.env.TELEGRAM_BOT_TOKEN ? ["TELEGRAM_BOT_TOKEN"] : []),
      ...(!process.env.BOT_API_SECRET || process.env.BOT_API_SECRET.length < 32 ? ["BOT_API_SECRET"] : []),
      ...(!process.env.CORS_ORIGIN?.split(",").some((origin) => origin.trim()) ? ["CORS_ORIGIN"] : []),
      ...(parseAdminTelegramIds(process.env.GAME_ADMIN_TELEGRAM_IDS).length === 0 ? ["GAME_ADMIN_TELEGRAM_IDS"] : []),
      ...(/^(replace-with|change-me|your-)/i.test(process.env.BOT_API_SECRET ?? "") ? ["BOT_API_SECRET"] : []),
    ];
    if (missing.length) return reply.code(503).send({ status: "not_ready", missing });
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ready", service: "football-empire-api" };
    } catch (error) {
      request.log.error({ error }, "Readiness database check failed");
      return reply.code(503).send({ status: "not_ready", missing: ["DATABASE_CONNECTION"] });
    }
  });

  app.get("/health", async (_request, reply) =>
    reply.code(200).send(
      healthResponse.parse({
        status: "ok",
        service: "football-empire-api",
        version: "0.1.0",
      }),
    ),
  );

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  // Route registration is synchronous; handlers perform their own async work.
  registerTelegramAuthRoutes(app);
  registerBotAuthRoutes(app);
  registerGameRoutes(app);
  registerClubOperationsRoutes(app);
  registerPlayerMarketRoutes(app);
  registerPlayerDevelopmentRoutes(app);
  registerMatchRoutes(app);
  registerMatchNotificationRoutes(app);
  registerGroupRoutes(app, { requireMembershipPort: Boolean(options.groupMembershipPort) });
  registerAllianceRoutes(app, { requirePort: Boolean(options.alliancePort), ...(options.alliancePort ? { port: options.alliancePort } : {}) });
  registerAdminRoutes(app, { ...(options.adminAlliancePort ? { adminAlliancePort: options.adminAlliancePort } : {}) });
  registerAdminLeagueRoutes(app);
  registerGiftCodeRoutes(app);
  registerTelegramMessageDeletionRoutes(app);
  registerLeagueNoticeRoutes(app);
  registerAdminGroupBroadcastRoutes(app);
  registerBotRuntimeRoutes(app, { ...(options.botRuntimeLeasePort ? { leasePort: options.botRuntimeLeasePort } : {}), requireLeasePort: true });
  registerPublicClubRoutes(app, options.publicClubLogoRepository, options.publicClubReadRepository);
  registerPublicPlayerRecordRoutes(app, options.publicPlayerRecordRepository);
  registerSeasonAwardRoutes(app);
  registerStoreRoutes(app);
  registerEventTournamentRoutes(app);

  app.get("/v1", async () => ({
    name: "Football Empire API",
    apiVersion: "v1",
    principle: "Bot and Mini App use the same game API.",
  }));

  return app;
}