# Football Empire — Development Roadmap

Last reviewed: 2026-11-14
Branch reviewed: `feat/foundation`
Reviewed baseline commit: `e5215aca38a875029512c59b05b3e172e40a6fbb`

## Product and architecture principles

Football Empire is a Telegram-first football management MMO. Telegram Bot, Telegram Mini App, and Telegram group interactions are clients of one authoritative game platform.

Non-negotiable product rules:

- One Telegram identity owns one player account and one primary club.
- A club and its wallet belong to the user, never to a Telegram group.
- Users can play the core game without joining a group.
- Bot, Mini App, and group commands use the same server-side game rules and application services.
- Currency changes are atomic, idempotent, auditable ledger transactions.
- Match outcomes, rewards, scheduled income/costs, and market transfers are applied once.
- Group features add social competition; they do not fork game state or create group-owned clubs.

## Repository audit at the reviewed commit

### Implemented foundation

- Fastify API with Telegram Mini App `initData` verification.
- Bot-to-API shared-secret authentication.
- User/club onboarding through the Mini App authentication endpoint.
- Starter wallets and ledger grants.
- Generated starter squad, strongest-available default XI, and authenticated profile, wallet, squad, lineup and tactics endpoints.
- Bot-only onboarding through authenticated `/v1/auth/bot` with the same provisioning service as Mini App authentication.
- Special-player catalog and idempotent seed script.
- Special-player pack acquisition service with Gold debit, per-club duplicate protection, acquisition history, and ledger entry.
- Generated-player transfer market with listing, cancellation, purchase, expiry handling, and ledger transfers.
- Persian RTL Mini App market, lineup/tactics and player-development screens.
- Bot commands for onboarding, club/wallet, squad, lineup, player development, training, contract renewal, market, and special-player acquisition.
- PostgreSQL Prisma schema includes preliminary Telegram group, membership, and group-challenge models.

### Important gaps and risks

1. **Bot-only onboarding is incomplete.** The current `/start` handler only sends a welcome message. Account creation is currently performed by `POST /v1/auth/telegram` using Mini App `initData`. A user who interacts only with the Bot is not provisioned before using account-dependent commands.
2. **The Bot currently uses long polling.** `bot.start()` is not the Cloudflare Workers webhook entry point. The Bot needs a webhook adapter and explicit Telegram webhook secret validation.
3. **The API is a Node/Fastify server.** `server.ts` calls `app.listen()`; it is not currently a Workers fetch handler. Do not assume it can be deployed unchanged as a Worker.
4. **The current API authorization is transport-specific.** Bot identity is accepted from a Telegram ID header when the shared secret matches. The Worker must validate Telegram's webhook secret before trusting the sender ID, and the shared secret must never reach the browser.
5. **Mini App coverage is narrow.** The current web client is essentially a market screen, not the full club-management game.
6. **Group gameplay is only a data-model starting point.** There are no complete group registration, challenge lifecycle, invitation/acceptance, scheduling, match resolution, standings, or reward flows.
7. **The match engine and competition lifecycle are absent.** No fixtures, match simulation, league tables, cups, seasons, or match-event history are implemented.
8. **Club operations are incomplete.** Player training, fatigue/recovery, injuries, morale, ageing/retirement, contract renewal/expiry, coach effects, and basic weekly payroll are now implemented. Stadium, training-ground upgrades, academy, coach hiring/progression, sponsorship, ticketing, and broader recurring operating costs remain open.
9. **Economy operations need further development.** Training costs and weekly payroll are ledger-backed; payroll arrears and morale penalties are tracked. Sponsorship, ticketing, maintenance, facility costs, match rewards, full financial statements, and administrative tuning remain open.
10. **Security and reliability coverage is early.** Add authorization boundary tests, concurrency/idempotency tests, rate limiting, audit events, input validation, abuse controls, and operational observability.
11. **The web client needs production-grade state handling.** API errors, loading/empty states, retry behavior, duplicate submissions, and Telegram-unavailable behavior need consistent treatment.

## Implementation progress

### Completed on 2026-11-14 — Bot-only onboarding foundation

- Added a transport-neutral Telegram account provisioning service shared by Mini App authentication and Bot onboarding.
- Added authenticated `POST /v1/auth/bot`, requiring the server-to-server Bot secret and a validated Telegram sender ID.
- Changed private Bot `/start` to create or load the account and primary club without requiring Mini App launch; group `/start` does not expose account information.
- Added API tests for missing Bot secret, invalid Bot secret, and invalid profile input.
- Corrected CI seed verification to query the Prisma model and fail unless exactly 15 curated special-player records exist.
- Updated README implementation notes.

### Completed on 2026-11-14 — Starting XI and tactics foundation

- Added domain-level formation slot contracts and lineup validation for 4-3-3, 4-4-2, 3-5-2 and 4-2-3-1.
- Added Club formation/tactics/version fields and Player lineup slots with a uniqueness constraint and a committed Prisma migration.
- Existing clubs with a squad but no lineup receive a default strongest-available 4-3-3 once; existing configured lineups are preserved.
- Added authenticated GET/PUT lineup API endpoints with active-player ownership checks, positional validation, exactly-one-goalkeeper rule, and optimistic version protection.
- Listing a starting player for transfer clears that lineup slot and advances the club lineup version.
- Added Bot commands `/lineup` and `/setlineup`, plus starting-XI visibility in `/players`.
- Added a Mini App lineup/tactics editor using the same API and domain rules.

**Not yet complete at this point:** Player development was implemented as a foundation slice. Club operations, facilities, academy, sponsorship, match simulation, competitions, full group lifecycle, complete Bot/Mini App parity, admin controls, and operational hardening were still open. No Cloudflare Worker, live webhook, production deployment, or real database provisioning has been performed.

### Completed on 2026-11-14 — Player development and lifecycle foundation

- Added shared domain rules for focus-based training, training intensity, positional overall calculation, age/potential/coach/facility effects, fatigue cost, injury probability, annual ageing and retirement.
- Added server-side training service with one session per player per UTC game day, idempotency protection, atomic Cash debit, immutable ledger entry and training history.
- Added training eligibility rules; only active players can train, and goalkeeper-only focus cannot be assigned to outfield players.
- Added coach records provisioned for new and existing clubs. Training, recovery and medical skills affect player growth, recovery and injury risk.
- Added daily catch-up settlement for contract countdown, fitness recovery, injury recovery, morale, age progression, retirement, and expired market listings. Settlement is lazy/idempotent until scheduled Cloudflare jobs are implemented.
- Added contract renewals for 90/180/365 days, server-derived wage demand ranges, weekly salary storage, expiry suspension, renewal history and reactivation rules.
- Added weekly payroll for players and coach, prorated for contract days, applied atomically through the Cash wallet and ledger. Unpaid amounts carry as club wage arrears and reduce player morale.
- Added Bot commands /development, /train, /renew; expanded /players with status/fitness/morale/contract/wage details.
- Added Mini App player-development dashboard with attributes, training focus/intensity, training history, injury/fitness/morale status, contract renewal, wage ranges and payroll history.
- Added domain tests for training, age effects, injury risk, recovery, contract demand and payroll proration/arrears, plus API authentication tests for development endpoints.

**Remaining within this broader phase:** coach hiring and progression, facility upgrades, academy development, sponsorship and revenue streams, and a full financial statement remain part of the next club-operations phase.

### Completed on 2026-11-14 — Club facilities, academy, coaches and operating economy

- Added stadium, training-ground and academy levels with server-calculated upgrade costs, maximum-level checks, atomic Cash debits, immutable ledger entries and finance history.
- Added stadium capacity progression and configurable ticket pricing (10–500 Cash) with optimistic concurrency checks.
- Added a shared matchday ticket-revenue formula based on stadium capacity, ticket price and server-simulated attendance; actual gate receipts wait for the fixture/match engine so users cannot mint revenue by calling an endpoint.
- Added academy scouting: each paid scouting operation generates three youth prospects aged 16–18 with positions, attributes, current overall, potential and recruitment cost.
- Added prospect recruitment into the senior squad with ownership checks, conditional status transition, atomic Cash debit, ledger entry and finance record.
- Added coach hiring from balanced, youth-development and performance profiles. Hiring fee is debited and the new coach salary/skills feed into the existing training and payroll systems.
- Added coach progression with bounded skill increases, level caps, upgrade costs and salary changes.
- Added sponsor offers gated by club level and reputation, signing bonuses, recurring daily income and contract expiry.
- Added lazy, idempotent UTC club-economy settlement. Sponsor income is credited once; stadium/training/academy maintenance is accrued; available cash is paid without overdraft; unpaid costs carry as operating arrears.
- Added finance statements with categorized income and expense entries for player training, transfer purchases/sales, sponsor receipts, facility maintenance, coach signing/development, academy costs, facility upgrades and paid player/coach payroll.
- Added authenticated API routes for operations overview, finance statements, facility upgrades, ticket pricing, academy scouting/recruitment, coach hiring/progression and sponsor signing.
- Added Mini App operations dashboard and Bot commands /operations, /finance, /upgrade, /ticket-price, /scout, /recruit, /sponsor, /coach-upgrade, and /hire-coach.
- Added domain tests for facility costs/capacity, maintenance, academy costs, sponsor unlocks, coach upgrades and matchday ticket calculations, plus an ephemeral-PostgreSQL service test for the operations lifecycle.

**Remaining dependency:** ticket receipts require real fixtures, attendance and completed match results; these are deliberately part of the match-engine phase. Daily operations are currently lazily settled on authenticated reads/actions; Cloudflare Cron/Queues are deferred until the planned runtime phase.
## Recommended development sequence

### Phase 0 — Architecture and contracts

- Define the game command model and API contracts shared by Bot and Mini App.
- Separate transport adapters from domain/application services.
- Define identity provisioning for both Bot-only and Mini App users.
- Define game time, timezone, daily settlement boundaries, and season lifecycle.
- Document economy invariants and ledger reason codes.
- Define group membership/role permissions and challenge state transitions.

**Exit criteria:** one documented command contract and one authoritative service path per game action, independent of client.

### Phase 1 — Account, club, and squad loop

- Complete onboarding from Bot `/start` without requiring Mini App launch.
- Add club profile, squad detail, player detail, formation, lineup, and tactics.
- Player training, morale, fitness, injuries, ageing, contracts, coach effects and weekly payroll are implemented. Club coach hiring/progression is also implemented; future balancing remains.
- Add manager/coach profile and club progression.
- Ensure every action is available from both Bot and Mini App (with suitable UX for each).

**Exit criteria:** a new user can create and manage a club and squad using either client.

### Phase 2 — Club facilities and operations

- Stadium, training-ground and academy upgrades, capacity progression, and ticket-price settings are implemented.
- Academy scouting, youth prospect generation, recruitment and senior-squad promotion are implemented.
- Coach hiring and progression are implemented; salary changes feed weekly payroll.
- Sponsor contracts, signing bonuses, recurring income and contract expiry are implemented.
- Daily facility maintenance, operating arrears, weekly payroll and categorized financial statements are implemented with ledger-backed cash movements.
- Daily settlement is deterministic/idempotent but currently lazy; scheduled Cloudflare settlement remains deferred.
- Match attendance and ticket receipts are dependent on fixtures and the match engine (Phase 3).

**Exit criteria:** core club facilities and recurring operating economy are playable and traceable; matchday income is enabled when the match engine exists.

### Phase 3 — Match engine and competitions

**Implemented foundation on `feat/foundation`:**
- Deterministic 90-minute simulation with persisted engine version and seed, team/tactical/coach strength, expected goals and reproducible results.
- Chronological goal, yellow-card, red-card and injury events; per-player goals, assists, shots, passes, tackles, ratings and fitness loss.
- Friendly opponent discovery, scheduled fixtures, participant authorization, match history and post-match reports.
- Matchday attendance and gate revenue based on stadium capacity, ticket price, club reputation and team strength.
- Atomic match settlement: player fitness/injury updates, lineup version changes, reputation, appearance/win/draw rewards, Cash ledger and club finance entries.
- Round-robin league registration for 4–10 clubs, creator-controlled start, automatic single round-robin schedule, 3/1/0 standings, goal difference and completion state.\n- Single-elimination cups for four/eight clubs, automatic bracket advancement, deterministic penalty shootouts for tied knockout matches and champion completion state.
- Bot commands and Mini App match center for friendlies, match simulation, league registration/join/start and standings.

**Still outstanding:**
- Two-leg cups, promotion/relegation and multi-division season administration.
- Substitutions, tactical in-match changes, richer commentary and more detailed match reports.
- Season reset/rollover, scheduled match workers and group-hosted competitions (Phase 5).
- Balance simulations across large player populations and load/security testing.

**Exit criteria:** users can play a complete season and all outcomes/rewards are auditable and applied once. The current implementation is the first playable competition slice, not the final completion of Phase 3.

### Phase 4 — Transfers and player lifecycle

- Complete market filters, valuation, listing lifecycle, negotiation rules, and transaction history.
- Contracts, wages, renewals, loans, release, retirement, and player development.
- Special-player acquisition and reward issuance integrated into the game loop.
- Market anti-abuse controls and economic balancing.

**Exit criteria:** the player lifecycle and transfer economy are coherent and exploit-resistant.

### Phase 5 — Telegram groups and social competition

- Group linking and registration with role-aware permissions.
- Group challenge creation, invitation, acceptance, cancellation, and scheduling.
- Group tournaments/leagues, standings, results, and rewards.
- Group announcements and deep links to the Mini App.
- Multiple group memberships per user while retaining one account and club.
- Anti-spam, rate limits, replay protection, and group admin controls.

**Exit criteria:** group play works end-to-end without making group membership mandatory for core gameplay.

### Phase 6 — Full Bot and Mini App parity

- Bot command/menu coverage for all core game actions.
- Mini App screens for dashboard, club, squad, tactics, training, stadium, academy, finances, matches, competitions, market, and social play.
- Consistent Persian RTL UX, localization, notifications, and accessibility.
- Every operation uses the same application services and authorization rules.

**Exit criteria:** no core game capability is exclusive to only one client.

### Phase 7 — Admin, safety, and operations

- Admin controls for economy parameters, seasons, events, and catalog management.
- Auditable admin actions and permission tiers.
- Abuse detection, rate limiting, anti-cheat checks, idempotency, and concurrency controls.
- Structured logs, metrics, traces, alerts, backups, and recovery procedures.
- Load, security, integration, and economy simulation tests.

**Exit criteria:** release-readiness review passes before any public launch.

## Cloudflare-first initial runtime plan

Cloudflare is the preferred initial execution platform, but each component should use the runtime suited to it.

### Proposed service layout

- **Telegram Bot Worker:** grammY webhook adapter. Receive Telegram updates through the Worker's `fetch` handler, validate Telegram's `secret_token` header, then dispatch Bot commands to shared application services/API. Do not use long polling in Workers.
- **Game API:** keep the existing Fastify server out of Workers until a compatibility spike proves the complete dependency path. Preferred Worker-native direction is a fetch-handler API (for example Hono or a small standards-based router) that calls the same application/domain services. An alternative is to run the existing Fastify API on a conventional Node runtime while the Bot Worker calls it over HTTPS.
- **PostgreSQL:** retain PostgreSQL as the authoritative relational store. For Workers connectivity, evaluate Cloudflare Hyperdrive with a supported PostgreSQL driver/Prisma driver adapter. Do not replace PostgreSQL with D1 merely to simplify deployment; the current Prisma schema, relations, transactions, and economy invariants are PostgreSQL-oriented.
- **Mini App:** deploy as a static/edge frontend where possible. If server-side Next.js is needed, run a compatibility assessment before choosing Cloudflare's currently recommended Next.js path; the existing project uses Next.js 15 and must not be migrated blindly.
- **Scheduled game operations:** use Cron Triggers to enqueue settlement work; process durable jobs through Queues or Workflows with idempotency keys and database transactions.
- **Group/match coordination:** use PostgreSQL as source of truth. Consider Durable Objects only for coordination/presence or serialized real-time sessions where their single-instance model adds value; never make them the only record of currency or match results.
- **Secrets:** store Telegram bot token, webhook secret, database credentials, and service-to-service secrets as Worker secrets. Never expose them in `NEXT_PUBLIC_*` variables or Mini App bundles.

### Cloudflare implementation gates

1. Create a minimal Bot Worker proof of concept with grammY webhook handling, webhook-secret validation, health response, and one harmless command.
2. Prove Worker-to-API authentication and account provisioning without trusting a client-supplied Telegram ID.
3. Run a compatibility spike for the chosen PostgreSQL/Hyperdrive/Prisma driver path and verify serializable transactions and idempotency.
4. Decide whether the API remains Node-hosted or becomes Worker-native based on measured compatibility, not assumptions.
5. Evaluate the current Next.js 15 Mini App before selecting vinext/OpenNext/static deployment.
6. Add preview environments and CI checks. Do not deploy to a production Telegram webhook until explicitly approved.

## Testing policy during development

Testing is not postponed entirely. Keep fast checks close to implementation:

- Domain unit tests for economy, player generation, match simulation, progression, and state transitions.
- Service tests for authorization, ledger atomicity, idempotency, and concurrency.
- API contract tests with mocked or ephemeral dependencies where practical.
- Typecheck and build checks on each feature branch change.

Defer full environment setup, persistent staging database provisioning, end-to-end Telegram webhook tests, load testing, and launch rehearsal until the relevant feature set is implemented.

## Current CI note

The current CI workflow uses an ephemeral PostgreSQL 16 service and now verifies:

- Prisma schema validation and all committed migrations.
- Special-player catalog seed and exact catalog count.
- Shared domain build, monorepo TypeScript checks, unit tests, API tests, and production builds.
- Player lifecycle integration against the ephemeral database, including daily training, idempotent replay, contract renewal, contract expiry, fitness recovery, weekly payroll, ledger debit, and arrears behavior.
- Club operations integration against ephemeral PostgreSQL, including facility upgrades, ticket-price concurrency, academy scouting/recruitment, coach hiring/progression, sponsor signing, daily income/maintenance settlement, operating arrears and finance entries.

The earlier seed-verification command defect at commit `daa2b124a03c6d61169f897c7bcee54fa705343a` was corrected. CI does not connect to a persistent staging or production database; no live Telegram webhook or Cloudflare runtime is exercised yet.

## Scope and release guardrails

- Development target: `feat/foundation` (or a new feature branch created from it).
- No merge to `main`, no production deployment, and no live Telegram webhook changes without explicit approval.
- No use of the unrelated Tosan Supabase project as Football Empire storage.
- No real database migration/seed until a dedicated Football Empire development database is explicitly configured and approved.
