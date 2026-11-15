import "dotenv/config";
import { buildApp } from "./app.js";
import { processDueMatchRuntimes } from "./game/match-service.js";
const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";
const app = buildApp();
try {
  await app.listen({ port, host });
  app.log.info({ host, port }, "Football Empire API is running");
  let workerRunning = false;
  const matchWorker = setInterval(() => {
    if (workerRunning) return;
    workerRunning = true;
    void processDueMatchRuntimes("api-match-worker", new Date(), 10)
      .then((result) => {
        if (result.advanced || result.settled || result.failed) app.log.info(result, "Match runtime worker tick");
      })
      .catch((error: unknown) => app.log.error({ error }, "Match runtime worker failed"))
      .finally(() => { workerRunning = false; });
  }, 5_000);
  matchWorker.unref();
}
catch (error) { app.log.error(error); process.exit(1); }
