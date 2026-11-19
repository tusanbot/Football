import Fastify from "fastify";
import { z } from "zod";
import { registerTelegramAuthRoutes } from "./auth/routes.js";
import { registerBotAuthRoutes } from "./auth/bot-routes.js";
import { registerGameRoutes } from "./game/routes.js";
import { registerClubOperationsRoutes } from "./game/club-operations-routes.js";
import { registerPlayerMarketRoutes } from "./players/market-routes.js";
import { registerPlayerDevelopmentRoutes } from "./players/player-development-routes.js";
import { registerMatchRoutes } from "./game/match-routes.js";
import { registerMatchNotificationRoutes } from "./game/match-notification-routes.js";
import { registerGroupRoutes } from "./groups/group-routes.js";
import type { GroupMembershipPort } from "./groups/group-membership-context.js";
import { withGroupMembershipPort } from "./groups/group-membership-context.js";
import { registerAllianceRoutes } from "./groups/alliance-routes.js";
import { prisma } from "./db.js";
import { parseAdminTelegramIds, parseCorsOrigins } from "./runtime-config.js";
import { registerAdminRoutes } from "./admin-routes.js";
import { registerAdminLeagueRoutes } from "./admin-league-routes.js";
import { registerGiftCodeRoutes } from "./gift-code-routes.js";
import { registerTelegramMessageDeletionRoutes } from "./telegram-message-deletion-routes.js";
import { registerLeagueNoticeRoutes } from "./league-notice-routes.js";
import { registerAdminGroupBroadcastRoutes } from "./admin-group-broadcast-routes.js";
import { registerBotRuntimeRoutes } from "./bot-runtime-routes.js";
import { registerPublicClubRoutes } from "./public-club-routes.js";
import { registerPublicPlayerRecordRoutes } from "./players/public-record-routes.js";
import { registerSeasonAwardRoutes } from "./game/season-award-routes.js";
import { registerStoreRoutes } from "./store/store-routes.js";
import { registerEventTournamentRoutes } from "./event-tournament-routes.js";

const healthResponse = z.object({
  status: z.literal("ok"),
  service: z.literal("football-empire-api"),
  version: z.string(),
});

export function buildApp(options: { logger?: boolean; pluginTimeout?: number; groupMembershipPort?: GroupMembershipPort } = {}) {
  const app = Fastify({
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

  // Establish a per-request AsyncLocalStorage scope before route hooks/handlers run.
  // The callback-style hook is intentional: done() schedules Fastify's continuation
  // from inside the ALS scope, avoiding a global mutable repository singleton.
  if (options.groupMembershipPort) {
    app.addHook("onRequest", (_request, _reply, done) => {
      withGroupMembershipPort(options.groupMembershipPort!, () => done());
    });
  }

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
  registerAllianceRoutes(app);
  registerAdminRoutes(app);
  registerAdminLeagueRoutes(app);
  registerGiftCodeRoutes(app);
  registerTelegramMessageDeletionRoutes(app);
  registerLeagueNoticeRoutes(app);
  registerAdminGroupBroadcastRoutes(app);
  registerBotRuntimeRoutes(app);
  registerPublicClubRoutes(app);
  registerPublicPlayerRecordRoutes(app);
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