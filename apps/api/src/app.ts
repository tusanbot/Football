import Fastify from "fastify";
import cors from "@fastify/cors";
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
import { registerAllianceRoutes } from "./groups/alliance-routes.js";
import { prisma } from "./db.js";
import { registerAdminRoutes } from "./admin-routes.js";
import { registerAdminLeagueRoutes } from "./admin-league-routes.js";
import { registerGiftCodeRoutes } from "./gift-code-routes.js";
import { registerTelegramMessageDeletionRoutes } from "./telegram-message-deletion-routes.js";
import { registerLeagueNoticeRoutes } from "./league-notice-routes.js";
import { registerPublicClubRoutes } from "./public-club-routes.js";
import { registerPublicPlayerRecordRoutes } from "./players/public-record-routes.js";
import { registerSeasonAwardRoutes } from "./game/season-award-routes.js";

const healthResponse = z.object({
  status: z.literal("ok"),
  service: z.literal("football-empire-api"),
  version: z.string(),
});

export function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    requestIdHeader: "x-request-id",
    bodyLimit: 1_048_576,
  });

  void app.register(cors, {
    origin: process.env.CORS_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? false,
    credentials: true,
  });

  app.get("/ready", async (_request, reply) => {
    const missing = [
      ...(!process.env.DATABASE_URL ? ["DATABASE_URL"] : []),
      ...(!process.env.TELEGRAM_BOT_TOKEN ? ["TELEGRAM_BOT_TOKEN"] : []),
      ...(!process.env.BOT_API_SECRET || process.env.BOT_API_SECRET.length < 32 ? ["BOT_API_SECRET"] : []),
      ...(!process.env.CORS_ORIGIN?.split(",").some((origin) => origin.trim()) ? ["CORS_ORIGIN"] : []),
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
  registerGroupRoutes(app);
  registerAllianceRoutes(app);
  registerAdminRoutes(app);
  registerAdminLeagueRoutes(app);
  registerGiftCodeRoutes(app);
  registerTelegramMessageDeletionRoutes(app);
  registerLeagueNoticeRoutes(app);
  registerPublicClubRoutes(app);
  registerPublicPlayerRecordRoutes(app);
  registerSeasonAwardRoutes(app);

  app.get("/v1", async () => ({
    name: "Football Empire API",
    apiVersion: "v1",
    principle: "Bot and Mini App use the same game API.",
  }));

  return app;
}