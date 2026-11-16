import { Hono } from "hono";
type LegacyRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  body?: unknown;
  routeOptions: { url: string };
  log: {
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
};
type LegacyReply = {
  code(status: number): LegacyReply;
  status(status: number): LegacyReply;
  header(name: string, value: string | number): LegacyReply;
  headers(values: Record<string, string | number>): LegacyReply;
  send(value?: unknown): LegacyReply;
  readonly sent: boolean;
};
import { registerTelegramAuthRoutes } from "../../../apps/api/src/auth/routes.js";
import { registerBotAuthRoutes } from "../../../apps/api/src/auth/bot-routes.js";
import { registerGameRoutes } from "../../../apps/api/src/game/routes.js";
import { registerClubOperationsRoutes } from "../../../apps/api/src/game/club-operations-routes.js";
import { registerPlayerMarketRoutes } from "../../../apps/api/src/players/market-routes.js";
import { registerPlayerDevelopmentRoutes } from "../../../apps/api/src/players/player-development-routes.js";
import { registerMatchRoutes } from "../../../apps/api/src/game/match-routes.js";
import { registerMatchNotificationRoutes } from "../../../apps/api/src/game/match-notification-routes.js";
import { registerGroupRoutes } from "../../../apps/api/src/groups/group-routes.js";
import { registerAllianceRoutes } from "../../../apps/api/src/groups/alliance-routes.js";
import { registerAdminRoutes } from "../../../apps/api/src/admin-routes.js";
import { registerAdminLeagueRoutes } from "../../../apps/api/src/admin-league-routes.js";
import { registerGiftCodeRoutes } from "../../../apps/api/src/gift-code-routes.js";
import { registerTelegramMessageDeletionRoutes } from "../../../apps/api/src/telegram-message-deletion-routes.js";
import { registerLeagueNoticeRoutes } from "../../../apps/api/src/league-notice-routes.js";
import { registerAdminGroupBroadcastRoutes } from "../../../apps/api/src/admin-group-broadcast-routes.js";
import { registerBotRuntimeRoutes } from "../../../apps/api/src/bot-runtime-routes.js";
import { registerPublicClubRoutes } from "../../../apps/api/src/public-club-routes.js";
import { registerPublicPlayerRecordRoutes } from "../../../apps/api/src/players/public-record-routes.js";
import { registerSeasonAwardRoutes } from "../../../apps/api/src/game/season-award-routes.js";
import { registerStoreRoutes } from "../../../apps/api/src/store/store-routes.js";
import { parseCorsOrigins } from "../../../apps/api/src/runtime-config.js";

type Handler = (request: LegacyRequest, reply: LegacyReply) => unknown | Promise<unknown>;
type RouteDefinition = { method: string; path: string; handler: Handler };

class RouteRegistry {
  readonly routes: RouteDefinition[] = [];
  get(path: string, handler: Handler) { this.add("GET", path, handler); }
  post(path: string, handler: Handler) { this.add("POST", path, handler); }
  put(path: string, handler: Handler) { this.add("PUT", path, handler); }
  patch(path: string, handler: Handler) { this.add("PATCH", path, handler); }
  delete(path: string, handler: Handler) { this.add("DELETE", path, handler); }
  private add(method: string, path: string, handler: Handler) { this.routes.push({ method, path, handler }); }
}

function jsonResponse(value: unknown, status: number, headers: Headers): Response {
  if (value instanceof Response) return value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return new Response(value as unknown as BodyInit, { status, headers });
  }
  if (typeof value === "string") {
    if (!headers.has("content-type")) headers.set("content-type", "text/plain; charset=utf-8");
    return new Response(value, { status, headers });
  }
  if (value === undefined || value === null) return new Response(null, { status, headers });
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item), { status, headers });
}

function queryObject(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams) {
    const previous = query[key];
    query[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return query;
}

export function createWorkersApiRouter() {
  const registry = new RouteRegistry();
  const registrar = registry as unknown as Parameters<typeof registerTelegramAuthRoutes>[0];
  registerTelegramAuthRoutes(registrar);
  registerBotAuthRoutes(registrar);
  registerGameRoutes(registrar);
  registerClubOperationsRoutes(registrar);
  registerPlayerMarketRoutes(registrar);
  registerPlayerDevelopmentRoutes(registrar);
  registerMatchRoutes(registrar);
  registerMatchNotificationRoutes(registrar);
  registerGroupRoutes(registrar);
  registerAllianceRoutes(registrar);
  registerAdminRoutes(registrar);
  registerAdminLeagueRoutes(registrar);
  registerGiftCodeRoutes(registrar);
  registerTelegramMessageDeletionRoutes(registrar);
  registerLeagueNoticeRoutes(registrar);
  registerAdminGroupBroadcastRoutes(registrar);
  registerBotRuntimeRoutes(registrar);
  registerPublicClubRoutes(registrar);
  registerPublicPlayerRecordRoutes(registrar);
  registerSeasonAwardRoutes(registrar);
  registerStoreRoutes(registrar);
  registry.get("/v1", async () => ({
    name: "Football Empire API",
    apiVersion: "v1",
    principle: "Bot and Mini App use the same game API.",
  }));

  const router = new Hono();
  router.use("*", async (context, next) => {
    const origin = context.req.header("origin");
    let allowedOrigins: string[] = [];
    try { allowedOrigins = parseCorsOrigins(process.env.CORS_ORIGIN); } catch { /* fail closed */ }
    if (origin && allowedOrigins.includes(origin)) {
      context.header("access-control-allow-origin", origin);
      context.header("access-control-allow-credentials", "true");
      context.header("vary", "Origin");
    }
    context.header("cache-control", "no-store");
    context.header("pragma", "no-cache");
    context.header("x-content-type-options", "nosniff");
    context.header("x-frame-options", "DENY");
    context.header("referrer-policy", "no-referrer");
    context.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if (process.env.NODE_ENV === "production") context.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    if (context.req.method === "OPTIONS") {
      if (origin && !allowedOrigins.includes(origin)) return context.body(null, 403);
      context.header("access-control-allow-methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
      context.header("access-control-max-age", "86400");
      const requestedHeaders = context.req.header("access-control-request-headers");
      if (requestedHeaders && requestedHeaders.length <= 2048) context.header("access-control-allow-headers", requestedHeaders);
      return context.body(null, 204);
    }
    if (origin && !allowedOrigins.includes(origin)) return context.json({ error: "CORS_ORIGIN_NOT_ALLOWED" }, 403);
    await next();
  });

  for (const route of registry.routes) {
    router.on(route.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE", route.path, async (context) => {
      const url = new URL(context.req.url);
      let body: unknown;
      if (!["GET", "HEAD"].includes(route.method) && context.req.raw.body) {
        const contentLength = Number(context.req.header("content-length") ?? 0);
        if (Number.isFinite(contentLength) && contentLength > 1_048_576) return context.json({ error: "PAYLOAD_TOO_LARGE" }, 413);
        const bytes = await context.req.raw.clone().arrayBuffer();
        if (bytes.byteLength > 1_048_576) return context.json({ error: "PAYLOAD_TOO_LARGE" }, 413);
        const raw = new TextDecoder().decode(bytes);
        if (raw) {
          const contentType = context.req.header("content-type") ?? "";
          if (contentType.includes("application/json")) {
            try { body = JSON.parse(raw) as unknown; }
            catch { return context.json({ error: "INVALID_REQUEST_BODY" }, 400); }
          } else body = raw;
        }
      }

      const requestHeaders: Record<string, string> = {};
      context.req.raw.headers.forEach((value, key) => { requestHeaders[key.toLowerCase()] = value; });
      const request = {
        method: route.method,
        url: url.pathname + url.search,
        headers: requestHeaders,
        params: context.req.param(),
        query: queryObject(url),
        body,
        routeOptions: { url: route.path },
        log: {
          error: (...args: unknown[]) => console.error(...args),
          warn: (...args: unknown[]) => console.warn(...args),
          info: (...args: unknown[]) => console.info(...args),
          debug: (...args: unknown[]) => console.debug(...args),
        },
      } satisfies LegacyRequest;

      let statusCode = 200;
      let sent = false;
      let sentBody: unknown;
      const responseHeaders = new Headers();
      const reply = {
        code(status: number) { statusCode = status; return this; },
        status(status: number) { statusCode = status; return this; },
        header(name: string, value: string | number) { responseHeaders.set(name, String(value)); return this; },
        headers(values: Record<string, string | number>) { for (const [name, value] of Object.entries(values)) responseHeaders.set(name, String(value)); return this; },
        send(value?: unknown) { sent = true; sentBody = value; return this; },
        get sent() { return sent; },
      } satisfies LegacyReply;

      try {
        const result = await route.handler(request, reply);
        return jsonResponse(sent ? sentBody : result, statusCode, responseHeaders);
      } catch (error) {
        console.error("Cloudflare API route failed", { method: route.method, path: route.path, error });
        return context.json({ error: "INTERNAL_SERVER_ERROR" }, 500);
      }
    });
  }

  router.notFound((context) => context.json({ error: "NOT_FOUND" }, 404));
  router.onError((error, context) => {
    console.error("Cloudflare API router failure", error);
    return context.json({ error: "INTERNAL_SERVER_ERROR" }, 500);
  });
  return router;
}
