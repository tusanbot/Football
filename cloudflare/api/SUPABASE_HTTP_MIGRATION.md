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

Tests cover the repository RPC contract, numeric conversion and malformed payload rejection, plus the route response envelope, team selection, manual awards, and query validation. As with the first route, apply the migration to an isolated target and compare Prisma and RPC-backed responses against the same fixture before enabling Supabase secrets in staging. The matching RPC migration was applied separately to isolated Staging; no Worker deployment or Production change was made.


## Third migrated operation: wallet ledger entry

`apps/api/src/economy/wallet-service.ts` now supports a request-scoped wallet port. The Cloudflare API creates `SupabaseWalletEntryRepository` per request and binds it with `AsyncLocalStorage`; standard Fastify execution retains the existing Prisma transaction. The context is request-local, not a mutable Worker-global singleton.

`apply_wallet_entry` performs the wallet lock, idempotency comparison, balance validation, ledger insert, and balance/version update inside one PostgreSQL transaction. It uses `SECURITY INVOKER`, a fixed search path, row locking, a unique idempotency key, and explicit execution grants: `service_role` only; `PUBLIC`, `anon`, and `authenticated` are revoked.

The migration is `20261118110000_wallet_entry_rpc`. It has been applied to the isolated Football Empire Staging database. A rollback-scoped SQL verification exercised first application and replay behavior, asserted the balance/version results, and confirmed that the test ledger insert was rolled back. Privilege checks confirmed `service_role` can execute the function while `anon` and `authenticated` cannot.

This is a scoped migration, not full Prisma removal. The Worker still creates a Prisma client for the remaining API routes and Durable Object scheduler. The wallet HTTP path must still pass the repository test suite and end-to-end API validation before this operation is considered production-ready.


## Fourth migrated operation: store purchase

`purchaseStoreItem` now supports a request-scoped `StorePurchasePort`. With Supabase HTTP configured, the Cloudflare API routes this command through `SupabaseStorePurchaseRepository`; the standard Fastify runtime keeps its Prisma transaction.

`purchase_store_item` locks the wallet, validates the purchase idempotency key and price/quantity, inserts the purchase and debit ledger entry, updates the wallet balance/version, and grants inventory in one PostgreSQL transaction. Bigint balances are returned as decimal text to avoid JavaScript precision loss. The function is `SECURITY INVOKER` and executable only by `service_role` when that role exists; public, anon, and authenticated execution are revoked.

The migration is `20261118120000_store_purchase_rpc`. Apply and rollback-test it on Staging before enabling the route. The existing `useStoreItem` player-stat mutation and store snapshot reads still use Prisma; this RPC covers only purchase execution.


## Fifth migrated operation: store-item use

`useStoreItem` now supports a request-scoped `StoreItemUsePort`. The Cloudflare API routes it through `SupabaseStoreItemUseRepository`, while standard Fastify execution retains the Prisma transaction.

`use_store_item` validates club ownership and player eligibility, locks the player and inventory rows, rechecks idempotency after acquiring locks, records the use, decrements inventory, and updates fitness/morale in one PostgreSQL transaction. The recheck prevents concurrent duplicate requests from consuming multiple items. The function is `SECURITY INVOKER` with a fixed search path and execution restricted to `service_role`.

The migration is `20261118130000_store_item_use_rpc`. Apply and rollback-test it on Staging before enabling this route. Store snapshot reads remain on Prisma.


## Sixth migrated operation: player-market purchase

`buyMarketListing` now supports a request-scoped `MarketPurchasePort`. After the existing daily-settlement preflight, Cloudflare routes the financial transfer through `SupabaseMarketPurchaseRepository`; the standard Fastify runtime retains its Prisma transaction.

`buy_market_listing` locks the listing and player, checks ownership/contract/expiry, locks buyer and seller cash wallets in stable user-id order, transfers funds, moves the player, and writes both ledger and club-finance entries in one PostgreSQL transaction. Expired listings retain their existing state-transition outcomes. Bigint prices are returned as decimal strings. The function is `SECURITY INVOKER` and restricted to `service_role`.

The migration is `20261118140000_market_purchase_rpc`. Listing creation, cancellation, expiry sweeping, and market snapshot reads remain on Prisma; this RPC covers purchase settlement only.


## Seventh migrated operation: gift-code redemption

`redeemGiftCode` now supports a request-scoped `GiftCodeRedemptionPort`. Existing Telegram group membership verification remains outside the database transaction; after that preflight, Cloudflare executes the persisted redemption through `SupabaseGiftCodeRedemptionRepository`. Standard Fastify continues using the Prisma transaction.

`redeem_gift_code` locks the gift code, rechecks idempotency, enforces total/per-user limits and time windows, validates persisted group membership for group rewards, increments redemption count, and credits wallet balances/ledger or group points/ledger atomically. Wallet credits and reward amounts remain exact decimal strings. The function is `SECURITY INVOKER`, uses a fixed search path, and is restricted to `service_role`.

The migration is `20261118150000_gift_code_redemption_rpc`. The route's preliminary replay lookup and Telegram membership preflight still use Prisma; the redemption transaction itself is migrated.


## Eighth migrated operation: special-player pack acquisition

`acquireSpecialPlayer` now supports a request-scoped `SpecialAcquisitionPort`. Cloudflare routes pack purchases through `SupabaseSpecialAcquisitionRepository`; the standard Fastify runtime retains the Prisma transaction. Pack price, rarity and per-card copy limits are enforced inside PostgreSQL, not trusted from the caller.

`acquire_special_player` serializes idempotency keys, locks the selected special-player card and gold wallet, rechecks copy limits and per-club uniqueness, debits gold, creates the player and acquisition record, and inserts the ledger debit in one transaction. The selected player and exact gold balance are returned. The function is `SECURITY INVOKER`, uses a fixed search path, and is restricted to `service_role`.

The migration is `20261118160000_special_player_acquisition_rpc`. Legacy challenge claims, special-player offers, and other special-player read paths remain on Prisma.

## Runtime removal gate (current status)

The Supabase HTTPS repositories are still injected into a compatibility runtime; they do not yet replace every Prisma-backed route. The Worker entry point still creates a Prisma client, the Fastify API still imports Prisma, and the API package still carries Prisma/PostgreSQL driver dependencies. The Worker readiness endpoint must therefore continue requiring `DATABASE_URL` while any route or scheduler path can fall back to Prisma. Bot startup checks this endpoint and reports the missing configuration instead of starting against a partially available API.

Do not remove `DATABASE_URL`, Prisma packages, Prisma schema/type generation, or the historical migration runner until all of the following are verified:

1. Every route registered by `workers-router.ts` and every Fastify route has a Supabase HTTP repository or a deliberately retired endpoint.
2. Every scheduler, Durable Object, background job, bot runtime lease, and admin/group operation uses only Supabase HTTP/RPC.
3. No production runtime module imports `@prisma/client`, `pg`, `@prisma/adapter-pg`, or `src/db.ts`.
4. SQL migrations have an independent, deterministic runner and a migration ledger that preserves the already-applied database history.
5. CI validates SQL migrations, RPC grants/RLS, route parity, idempotency, concurrency, and Bot/Mini App end-to-end behavior without generating Prisma Client or invoking `prisma migrate`.

The current branch is a compatibility hardening step, not the completion of this gate. Keep the existing database configuration until the remaining route families are migrated and tested.

## Route-family audit: remaining Prisma blockers (2026-11-19)

This audit was performed against `feat/supabase-http-runtime-hardening` after PR #10's readiness hardening. It distinguishes a Worker route being gated on an HTTP port from the shared Fastify service having no Prisma implementation: the latter is still required by the Node API and is not removable merely because the Worker injects a port.

### Confirmed remaining group and authorization paths

- `apps/api/src/groups/group-routes.ts` imports `prisma` and uses it in both Bot-secret and Mini App actor authorization when the group-membership port does not supply actor status. The Cloudflare router requests the membership port, but this does not remove the Fastify fallback.
- `apps/api/src/groups/group-service.ts` imports Prisma and retains compatibility fallbacks for group registration/join, activity points, summaries/workspaces, shop/reward operations, challenges, and group leagues. `GroupMembershipPort` now exposes all five group-league operations as well as the existing membership, workspace, shop, reward, and challenge methods. The Node repository implements that full port, but the Prisma fallback remains when the Node server starts without Supabase credentials.
- Group-league operations now have dedicated HTTP RPCs and are wired in both Worker and Node Fastify when the corresponding port is configured. Their Prisma implementations remain only as a transitional compatibility fallback.
- `apps/api/src/groups/alliance-service.ts` retains Prisma implementations as a transitional fallback. Node Fastify now wires both public alliance operations and the three superadmin season actions through dedicated Supabase HTTP ports/RPCs when credentials are configured.
- Group route authorization also calls Telegram's live administrator verification. Keep that external authorization check, and move persisted user/group suspension and membership reads behind a repository/RPC rather than bypassing them.

### Confirmed application-wide blockers

- `apps/api/src/server.ts` imports Prisma, requires `DATABASE_URL`, connects and probes PostgreSQL on startup, and runs match/promotion schedulers through Prisma-backed services.
- `apps/api/src/db.ts` imports `@prisma/client`, `@prisma/adapter-pg`, and `pg`; it owns the Prisma client, PostgreSQL pool, and request-scoped Prisma compatibility layer.
- `apps/api/package.json` still declares `@prisma/client`, `prisma`, `@prisma/adapter-pg`, and `pg`; its database scripts still call Prisma.
- The root `package.json` still exposes Prisma-backed generate/migrate scripts.
- `.github/workflows/ci.yml` still generates Prisma Client, validates Prisma schema, runs `prisma migrate deploy`, and uses Prisma seed/verification commands. This remains a transitional CI pipeline, not a Prisma-free migration pipeline.
- `cloudflare/api/src/index.ts` still imports `createPrismaClient` and `withPrismaClient`. The Worker therefore still has a PostgreSQL/Prisma compatibility path for routes, background jobs, and schedulers without complete repository coverage.

### Next migration tranches (required before package removal)

1. **Group leagues:** add a request-scoped group-league port; implement create/join/start/list/table repository methods and narrowly scoped SQL RPCs. Reuse the existing competition lifecycle semantics and ensure group membership, creator ownership, capacity, idempotency, and standings are checked atomically. Add SQL integration tests and Bot/Mini App route parity tests.
2. **Group authorization and remaining group service methods:** enumerate every exported group-service operation against the existing GroupMembershipPort; implement missing methods and remove the Worker's need for any Prisma fallback. Preserve Telegram administrator verification and suspension checks.
3. **Node API parity:** migrate the standard Fastify runtime to Supabase HTTP repositories, or retire that runtime explicitly. A Worker-only implementation is insufficient while `apps/api/src/server.ts` remains a supported runtime.
4. **Schedulers and background work:** move due-match, promotion, tournament finalization, and every other scheduled operation to HTTP repositories/RPCs; verify lease ownership, retries, idempotency, and durable scheduling before removing PostgreSQL access.
5. **Remaining route families:** audit auth/account provisioning, club and player CRUD, market listing lifecycle, admin/admin-league, gift codes, notifications, Telegram message deletion, store snapshots/item use, bot runtime, public club, records, season awards, and any routes registered in `workers-router.ts`. For each, record the concrete HTTP repository/RPC and parity tests.
6. **Independent SQL migration lifecycle:** move SQL files out of Prisma's migration directory only with a migration ledger/bootstrap process that recognizes already-applied migrations. Do not re-run historical SQL against an existing database.
7. **Removal gate:** only after both Node and Worker runtimes, all jobs, and CI are Prisma-free should Prisma schema/client/driver packages and `DATABASE_URL` / `DIRECT_URL` be removed.

### CI trigger correction

The hardening PR targets `feat/supabase-http-full-runtime`, not `main`. The CI workflow's pull-request trigger now includes that base branch so this PR can receive the existing transitional validation pipeline. This does **not** make CI Prisma-free; the workflow deliberately still exercises the legacy Prisma migration path until the independent SQL runner and full route migration are complete.

### Status after this audit

- [x] Correctly identify the group-league methods absent from the HTTP port.
- [x] Identify the remaining Node API, Worker, package, script, and CI Prisma dependencies.
- [x] Enable the current PR base branch in the CI pull-request trigger.
- [x] Implement group-league RPCs and repository wiring.
- [ ] Complete all remaining route and scheduler migrations.
- [ ] Introduce and validate an independent SQL migration runner/ledger.
- [ ] Remove Prisma packages and PostgreSQL wire-protocol dependencies.
- [ ] Pass full Prisma-free CI and Bot + Mini App parity tests.

No database, secrets, webhook, DNS, deployment, or production runtime settings were changed by this audit.

## Group leagues: Supabase HTTP migration tranche

The five Telegram-group league operations now have a request-scoped Supabase HTTP path:

- `createGroupLeague` → `create_group_league_http`
- `joinGroupLeague` → `join_group_league_http`
- `startGroupLeague` → `start_group_league_http`
- `getGroupLeagueTable` → `get_group_league_table_http`
- `listGroupLeagues` → `list_group_leagues_http`

Implementation details:
- `GroupMembershipPort` exposes all five operations and `SupabaseGroupMembershipRepository` calls the corresponding RPCs.
- `group-service.ts` uses the port when present; the standard Fastify runtime deliberately retains its Prisma fallback until Node API migration is complete.
- The Cloudflare Worker already binds `SupabaseGroupMembershipRepository` for the request and registers group routes with `requireMembershipPort: true`; these league routes therefore cannot silently fall back to Prisma in the Worker.
- The SQL migration `20261119430000_group_league_http_rpcs` enforces account/group suspension, active group status, persisted membership, manager role for creation/start, group-to-competition association, creator ownership, and idempotent creation.
- Join and start call the existing competition lifecycle RPCs within the same PostgreSQL transaction, preserving capacity checks, unique club entry, lineup validation, fixture generation, and replay behavior.
- Read RPCs return the existing API response envelope and cap league listing at 30 rows.
- Repository contract tests cover all five RPC names, arguments, and business-error propagation.
- An ephemeral PostgreSQL integration test now covers group-scoped creation/replay/conflict, manager-only creation, member joins, capacity-triggered atomic auto-start, fixture count, start replay, standings, and suspended-group rejection. CI runs this test immediately after the group membership RPC integration test.

This tranche does not remove Prisma from the Fastify runtime or from unrelated group operations. The migration has been added to the existing Prisma migration directory and will be exercised by CI's current migration pipeline; it has not been applied to any live database. The Node API group paths still use their Prisma fallback when no request-scoped port is installed.



## Node Fastify Telegram identity lookup

The Node Fastify runtime now scopes a server-only `resolve_telegram_user` PostgREST adapter per request when Supabase credentials are configured. This removes the Prisma user lookup/activity-touch fallback from authenticated Node API requests in that mode, including the superadmin action path. Missing or suspended accounts remain unauthenticated; the service-role key is never sent to clients.

## Node Fastify admin alliance-season RPC tranche

The Node Fastify admin actions for starting, closing, and reviewing alliance seasons now use dedicated Supabase PostgREST RPCs when the Node server has its Supabase service-role credentials configured:

- `admin_start_alliance_season_http`
- `admin_close_alliance_season_http`
- `admin_review_alliance_season_http`

The API route retains its existing `superadmin` authorization gate. The RPCs accept the actual authenticated admin Telegram ID (never the founder's ID), lock the target alliance/season rows, preserve season scoring and security-flag calculations, and write both `AllianceAuditLog` and `AdminAuditLog` in the same database transaction. Admin idempotency keys are checked against actor, action, target type, and target ID; duplicate matching requests return the original result, while key reuse for a different action/target is rejected. Season champion payouts remain atomic and ledger-idempotent.

These RPCs are granted only to `service_role`; public, `anon`, and `authenticated` execution is revoked. The new ephemeral PostgreSQL integration test covers start/close/review, actor attribution, audit atomicity, payout, and idempotency. No live migration has been applied.

## Node Fastify group membership: HTTP runtime wiring

The Node API now has a native Node-side `NodeSupabaseGroupMembershipRepository` that implements the complete `GroupMembershipPort` contract over HTTPS/PostgREST RPCs. It deliberately does not import Cloudflare Worker modules, and it validates the Supabase project origin, service-role key, timeout, redirect behavior, and typed business errors.

Runtime behavior:
- When both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present, `apps/api/src/server.ts` constructs the Node repository and injects it into `buildApp`.
- Supplying only one of those variables fails startup rather than silently switching the group subsystem back to Prisma.
- Fastify establishes the port through a callback-style `onRequest` hook and `AsyncLocalStorage`; the request continuation is created inside the request scope.
- Group routes are registered with `requireMembershipPort: true` when the Node repository is configured, preventing silent Prisma fallback for those routes.
- When neither variable is configured, the legacy Prisma group path remains available for transitional environments. Other API domains still use Prisma and still require `DATABASE_URL`.

Coverage added:
- Node transport tests assert direct HTTPS RPC addressing, server-side service-role headers, argument serialization, origin/key validation, and SQL business-error mapping.
- Fastify route test injects a port and verifies group actor authorization and league listing both use that injected port without requiring Prisma group reads.

This completes the Node runtime wiring for the existing GroupMembershipPort contract, but it does not mean all group-related behavior is Prisma-free: alliance routes/services, group-related background jobs, and any unported group code remain in the broader migration audit. No production environment variables were set and no database migration was applied.

## Node Fastify alliance tranche

The standard Node Fastify runtime now accepts an `AlliancePort` alongside the group-membership port. When both server-only Supabase credentials are configured, `server.ts` constructs `NodeSupabaseAllianceRepository`; a per-request `AsyncLocalStorage` scope makes it available to alliance service calls. The Node repository uses direct HTTPS PostgREST RPC calls, rejects non-Supabase origins and redirects, applies request timeouts, and maps database business errors to `AllianceServiceError`.

The HTTP-backed route/service surface includes alliance creation, group invitations and responses, treasury contributions, workspace reads, season lifecycle/review, alliance championships, cross-alliance competitions, and database-backed action throttling. The SQL RPCs are already represented by migrations and integration SQL in this repository. The runtime change does not apply migrations to any live database.

The three admin-only transaction helpers are now bypassed by the Node route when the dedicated admin RPC port is configured; their Prisma implementation remains solely as a transitional fallback when the Node runtime is started without Supabase credentials. This does not remove Prisma from other admin actions or from unrelated API domains.



## Node Fastify store transaction tranche

The Node API now wires direct HTTPS/PostgREST implementations for the two atomic store write operations:

- `purchase_store_item` handles wallet debit, ledger insertion, purchase idempotency, and inventory grant in one PostgreSQL transaction.
- `use_store_item` handles inventory consumption, player fitness/morale updates, and replay semantics in one PostgreSQL transaction.

Implementation:
- `NodeSupabaseStorePurchaseRepository` implements `StorePurchasePort`.
- `NodeSupabaseStoreItemUseRepository` implements `StoreItemUsePort`.
- `server.ts` constructs both adapters only when the Supabase URL and service-role key are configured together.
- Fastify scopes each port with `AsyncLocalStorage` per request; the service-role key remains server-side.
- The adapters reject non-Supabase origins, non-HTTPS requests, redirects, weak credentials, malformed RPC responses, and map known SQL business errors to the service's typed error handling.
- Node tests cover RPC names/arguments, authenticated HTTPS headers, bigint-safe balance strings, replay responses, business errors, malformed responses, and unsafe configuration.

Remaining store work: the Node store snapshot still uses Prisma for wallets/inventory/special-player catalog unless a snapshot port is added; its market listings and pack offers also depend on their respective Node ports. This tranche migrates store purchase and item-use writes only. No live database migration or production configuration was changed.


## Node Fastify wallet, market, and store snapshot tranche

The Node Fastify runtime now has direct Supabase HTTPS adapters for:

- Wallet ledger entries through `apply_wallet_entry`, preserving bigint balances as decimal strings and validating replay/version metadata.
- Market listing creation, cancellation, public listing reads, seller-owned listing reads, seller lookup, and atomic purchase through the existing market RPC set.
- Store snapshot reads through `get_store_snapshot`, with validation of wallet, inventory, and special-player catalog rows.
- All three adapters use the server-only service-role key, direct HTTPS project-origin validation, redirect rejection, request timeout, and strict response validation.
- `server.ts` constructs the adapters when Supabase credentials are configured and `app.ts` scopes them per request using AsyncLocalStorage.
- Node tests cover authenticated RPC calls, arguments, bigint-safe balances, market lifecycle responses, expiration results, snapshot shape, business error mapping, malformed responses, and unsafe origins.

Important remaining limitations:
- Market create/buy still call `settleClubDailyState` before the market RPC; that settlement path remains Prisma-backed and must be migrated before the full market route can be considered Prisma-free.
- Other wallet callers only use the HTTP adapter where they call `applyWalletEntry`; surrounding multi-step workflows may still perform Prisma reads/writes.
- Store snapshot migration covers the snapshot read only; store catalogue definitions remain application code and special acquisition/pack purchase remain separate operations.
- The Node server still requires `DATABASE_URL` and runs Prisma-backed background workers/readiness. Prisma removal is not complete.


## Node Fastify player development and club economy tranche

The Node Fastify server now constructs a direct HTTPS Supabase client and wires two additional request-scoped ports:

- `PlayerDevelopmentPort` uses the existing player-development HTTP RPCs for daily player state, age progression, injuries/recovery, contract expiry, weekly payroll, training, and contract renewal. The repository preserves the existing domain calculations and sends expected-state values to the atomic SQL RPCs.
- `ClubEconomySettlementPort` calls `settle_club_economy` through direct PostgREST RPC and validates decimal-string monetary values.
- The Node player-development repository is wired through Fastify AsyncLocalStorage. Consequently, market listing and purchase flows that call `settleClubDailyState` now use the Supabase-backed settlement path when the Node server is configured with Supabase credentials.
- Club operations that call `settleClubEconomy` now use the Supabase RPC path when configured.

The SQL RPCs are existing migrations; this tranche does not apply migrations to any live database.

Remaining limitations:
- Club operations other than the daily economy settlement still include Prisma-backed reads and mutations (sponsors, facilities, coaches, academy prospects, finance history, and upgrades).
- Player-development repository reads still use PostgREST table access for the club, players, coach, wallet, training logs, renewals, and payroll history. These are direct Supabase HTTP calls, but the surrounding workflows are not yet all atomic end-to-end.
- Node server startup/readiness and other background workers still require Prisma and `DATABASE_URL`. Full Prisma/pg removal remains incomplete.
