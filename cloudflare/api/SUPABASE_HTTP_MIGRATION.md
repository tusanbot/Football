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

The first Staging-only database RPC migrations are now applied and verified. No API routing, readiness, Worker secrets, bot webhook, DNS, or production configuration was changed. Existing Prisma runtime remains in place for route families that do not yet have a verified HTTP implementation. Do not configure plaintext PostgreSQL or disable TLS as a fallback.


## First migrated route: public player records

The `GET /v1/players/records` route now accepts an injected repository. The standard Fastify runtime keeps its existing Prisma implementation, while the Cloudflare Worker uses `SupabasePublicPlayerRecordRepository` when both Worker secrets are present:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The Worker repository calls the `get_public_player_records` PostgreSQL RPC. The matching migration is `20261118090000_public_player_records_rpc`. It performs completed-match filtering, aggregation, the three-appearance rating threshold, stable ordering, and the 1–50 row limit in one database statement. It exposes only leaderboard fields and grants RPC execution only to `service_role` when that role exists; `PUBLIC`, `anon`, and `authenticated` are revoked.

Until the two Worker secrets are configured, the Worker route intentionally falls back to the existing Prisma implementation. This preserves the current runtime while the route is validated; it does not mean the Worker is fully migrated. No Wrangler configuration, secrets, webhook, DNS, or deployment are changed by this code migration.

The repository tests validate RPC arguments, numeric conversion, and malformed-response rejection. The migration must be applied to the target Supabase database before enabling the Worker secrets for this route. Compare the Prisma and RPC route responses against the same database fixture before enabling it in staging.


## Second migrated route: season awards

The `GET /v1/seasons/:season/awards` route now supports an injected repository. The standard Fastify runtime retains its Prisma repository; the Cloudflare Worker uses `SupabaseSeasonAwardRepository` whenever both Supabase secrets are present.

The `get_season_award_data(p_season)` RPC returns season-scoped completed-match performance aggregates, manual player awards, and the completed-match count in one HTTPS RPC. The existing TypeScript award-selection logic remains authoritative for minimum appearances, position-group team-of-season slots, tie-breaks, and leaderboards. Manual awards are included unchanged. The migration is `20261118100000_season_award_data_rpc`; it is `SECURITY INVOKER` and executable only by `service_role` (with public, anon, and authenticated execution revoked).

Tests cover the repository RPC contract, numeric conversion and malformed payload rejection, plus the route response envelope, team selection, manual awards, and query validation. As with the first route, apply the migration to an isolated target and compare Prisma and RPC-backed responses against the same fixture before enabling Supabase secrets in staging. No remote migration, secrets, Worker deployment, or production change is part of this code commit.


## Third migrated operation: wallet ledger entry

`apps/api/src/economy/wallet-service.ts` now supports a request-scoped wallet port. The Cloudflare API creates `SupabaseWalletEntryRepository` per request and binds it with `AsyncLocalStorage`; standard Fastify execution retains the existing Prisma transaction. The context is request-local, not a mutable Worker-global singleton.

`apply_wallet_entry` performs the wallet lock, idempotency comparison, balance validation, ledger insert, and balance/version update inside one PostgreSQL transaction. It uses `SECURITY INVOKER`, a fixed search path, row locking, a unique idempotency key, and explicit execution grants: `service_role` only; `PUBLIC`, `anon`, and `authenticated` are revoked.

The migration is `20261118110000_wallet_entry_rpc`. It has been applied to the isolated Football Empire Staging database. A rollback-scoped SQL verification exercised first application and replay behavior, asserted the balance/version results, and confirmed that the test ledger insert was rolled back. Privilege checks confirmed `service_role` can execute the function while `anon` and `authenticated` cannot.

This is a scoped migration, not full Prisma removal. The Worker still creates a Prisma client for the remaining API routes and Durable Object scheduler. The wallet HTTP path must still pass the repository test suite and end-to-end API validation before this operation is considered production-ready.
