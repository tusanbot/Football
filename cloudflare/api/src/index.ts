interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  DB: D1Database;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

async function databaseStatus(db: D1Database): Promise<{ available: boolean; migrationVersion?: string }> {
  try {
    const row = await db
      .prepare("SELECT version FROM fe_schema_migrations WHERE version IN ('0001_platform_bootstrap', '0002_game_schema') ORDER BY CASE WHEN version = '0002_game_schema' THEN 0 ELSE 1 END LIMIT 1")
      .first<{ version: string }>();
    return row ? { available: true, migrationVersion: row.version } : { available: false };
  } catch {
    return { available: false };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", service: "football-empire-cloudflare-api", mode: "migration-scaffold" });
    }

    if (request.method === "GET" && url.pathname === "/ready") {
      const database = await databaseStatus(env.DB);
      return json({
        status: "not_ready",
        service: "football-empire-cloudflare-api",
        database,
        missing: [
          ...(!database.available ? ["D1_BOOTSTRAP_MIGRATION"] : []),
          ...(database.migrationVersion !== "0002_game_schema" ? ["GAME_SCHEMA_MIGRATION"] : []),
          "D1_ATOMIC_REPOSITORY",
          "GAME_API_ROUTE_PARITY",
          "AUTH_AND_RATE_LIMIT_MIGRATION",
        ],
      }, 503);
    }

    if (url.pathname.startsWith("/v1/")) {
      return json({
        error: "GAME_API_MIGRATION_INCOMPLETE",
        message: "The Cloudflare API scaffold is not serving game traffic. Use the existing development API until migration gates pass.",
      }, 503);
    }

    return json({ error: "NOT_FOUND" }, 404);
  },
};
