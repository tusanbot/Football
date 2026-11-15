import "dotenv/config";
import { buildApp } from "./app.js";
import { processDueMatchRuntimes } from "./game/match-service.js";
import { processDuePromotionOffers } from "./game/league-pyramid-service.js";
import { prisma } from "./db.js";
const required = ["DATABASE_URL", "TELEGRAM_BOT_TOKEN", "BOT_API_SECRET", "CORS_ORIGIN"] as const;
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) throw new Error("Missing required runtime configuration: " + missing.join(", "));
if ((process.env.BOT_API_SECRET ?? "").length < 32) throw new Error("BOT_API_SECRET must contain at least 32 characters.");
if (!(process.env.DATABASE_URL?.startsWith("postgres://") || process.env.DATABASE_URL?.startsWith("postgresql://"))) throw new Error("DATABASE_URL must use PostgreSQL.");
const corsOrigins = (process.env.CORS_ORIGIN ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
for (const origin of corsOrigins) {
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new Error("CORS_ORIGIN contains an invalid origin."); }
  if (parsed.origin !== origin || (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")) {
    throw new Error("CORS_ORIGIN must contain exact origins; production origins must use HTTPS.");
  }
}
const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";
const app = buildApp();
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  await app.listen({ port, host });
  app.log.info({ host, port }, "Football Empire API is running");
  let workerRunning = false;
  const matchWorker = setInterval(() => {
    if (workerRunning) return;
    workerRunning = true;
    void processDueMatchRuntimes("api-match-worker", new Date(), 10)
      .then(async (result) => {
        const promotions = await processDuePromotionOffers(new Date(), 50);
        if (result.advanced || result.settled || result.failed || promotions.accepted || promotions.completedLeagues) app.log.info({ ...result, promotions }, "Game worker tick");
      })
      .catch((error: unknown) => app.log.error({ error }, "Match runtime worker failed"))
      .finally(() => { workerRunning = false; });
  }, 5_000);
  matchWorker.unref();
}
catch (error) { app.log.error(error); process.exit(1); }
