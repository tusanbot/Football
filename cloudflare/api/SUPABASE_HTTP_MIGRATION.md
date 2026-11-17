# Cloudflare Workers to Supabase over HTTPS

## Objective

Replace the Worker runtime's PostgreSQL wire-protocol dependency with Supabase's HTTPS Data API (PostgREST and database RPC). The API, Telegram bot integration, Mini App integration, Durable Object match coordinator, and Cron triggers remain on Cloudflare.

## Runtime transport

`src/supabase-http.ts` is a Worker-compatible PostgREST transport. It:
- requires an HTTPS `*.supabase.co` project URL;
- keeps the service-role key server-side and sends it only in `apikey` and bearer authorization headers;
- validates table, RPC and query identifiers;
- supports GET/POST/PATCH/DELETE and RPC calls;
- applies a bounded request timeout;
- never retries mutations automatically;
- returns typed HTTP errors without logging credentials or request headers.

Configure these only as Worker environment values/secrets after staging settings are reviewed:
- `SUPABASE_URL`: HTTPS project URL, non-secret variable.
- `SUPABASE_SERVICE_ROLE_KEY`: encrypted secret; never put it in Wrangler vars, source control, client bundles, or logs.

The service-role key bypasses Row Level Security. Every public API route must continue to authenticate the Telegram actor and authorize ownership/roles before calling this transport. Never expose this client to the Mini App.

## Transaction model

PostgREST table requests are individual transactions. Never translate a multi-step Prisma transaction into multiple HTTP requests.

Each operation requiring atomicity must become a narrowly scoped PostgreSQL function exposed through `rpc`, with typed parameters and returns, authorization/ownership predicates, unique idempotency keys, row locks or conditional updates, explicit grants, and concurrency/rollback tests.

Initial RPC candidates: wallet deltas, player-market transfers, reward purchases, gift-code redemption, special-player acquisition, competition join/start, match runtime claiming/checkpoint decisions, tournament finalization, and notification claiming/delivery state.

## Migration sequence

1. Add and test the HTTPS transport (this change).
2. Inventory every Prisma model operation and raw SQL query; design server-only HTTP repositories.
3. Implement atomic RPCs for financial and contention-sensitive workflows.
4. Migrate read-only and low-risk CRUD routes in small groups.
5. Migrate auth/session and bot routes, preserving Telegram validation and authorization.
6. Move the Durable Object scheduler and match runtime to HTTP repositories/RPCs without losing due-work scheduling.
7. Run route parity, integration, replay, concurrency and load tests in staging.
8. Only after explicit approval, deploy staging and validate Bot + Mini App end-to-end. Production remains unchanged until separately authorized.

## Safety

This stage does not change API routing, readiness, Worker secrets, database migrations, bot webhook, DNS, or production. Existing Prisma runtime remains in place until each route family has a verified HTTP implementation. Do not configure plaintext PostgreSQL or disable TLS as a fallback.
