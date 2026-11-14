import "dotenv/config";
import { buildApp } from "./app.js";
const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";
const app = buildApp();
try { await app.listen({ port, host }); app.log.info({ host, port }, "Football Empire API is running"); }
catch (error) { app.log.error(error); process.exit(1); }
