import "dotenv/config";
import { buildApp } from "./app.js";
import { processDueMatchRuntimes } from "./game/match-service.js";
import { processDuePromotionOffers } from "./game/league-pyramid-service.js";
import { prisma } from "./db.js";
import { isValidTelegramBotToken, parseAdminTelegramIds, parseCorsOrigins } from "./runtime-config.js";
const required = ["DATABASE_URL", "TELEGRAM_BOT_TOKEN", "BOT_API_SECRET", "CORS_ORIGINS", "GAME_ADMIN_TELEGRAM_IDS"] as const;
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) throw new Error("Missing required runtime configuration: " + missing.join(", "));
if ((process.env.BOT_API_SECRET ?? "").length < 32 || /^(replace-with|change-me|your-)/i.test(process.env.BOT_API_SECRET ?? "")) throw new Error("BOT_API_SECRET must be a unique random secret of at least 32 characters; replace the example value.");
if (!isValidTelegramBotToken(process.env.TELEGRAM_BOT_TOKEN ?? "")) throw new Error("TELEGRAM_BOT_TOKEN does not look like a valid BotFather token.");
const adminIds = parseAdminTelegramIds(process.env.GAME_ADMIN_TELEGRAM_IDS);
if (!adminIds.length) throw new Error("GAME_ADMIN_TELEGRAM_IDS must contain at least one numeric Telegram user ID.");
if (!(process.env.DATABASE_URL?.startsWith("postgres://") || process.env.DATABASE_URL?.startsWith("postgresql://"))) throw new Error("DATABASE_URL must use PostgreSQL.");
const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
if (!corsOrigins.length) throw new Error("CORS_ORIGINS must contain at least one allowed origin.");
const port = Number(process.env.API_PORT ?? 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("API_PORT must be an integer between 1 and 65535.");
const host = process.env.API_HOST ?? "0.0.0.0";
const app = buildApp();
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
    workerTask = processDueMatchRuntimes("api-match-worker", new Date(), 10)
      .then(async (result) => {
        const promotions = await processDuePromotionOffers(new Date(), 50);
        if (result.advanced || result.settled || result.failed || promotions.accepted || promotions.completedLeagues) app.log.info({ ...result, promotions }, "Game worker tick");
      })
      .catch((error: unknown) => app.log.error({ error }, "Match runtime worker failed"))
      .finally(() => { workerRunning = false; workerTask = null; });
  }, 5_000);
  matchWorker.unref();
}
catch (error) { app.log.error(error); await prisma.$disconnect(); process.exit(1); }
