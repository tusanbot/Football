# Football Empire — Development Roadmap

Last reviewed: 2026-11-14
Branch reviewed: `feat/foundation`
Reviewed baseline commit: `daa2b124a03c6d61169f897c7bcee54fa705343a`

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
- Generated starter squad and authenticated profile, wallet, and squad endpoints.
- Special-player catalog and idempotent seed script.
- Special-player pack acquisition service with Gold debit, per-club duplicate protection, acquisition history, and ledger entry.
- Generated-player transfer market with listing, cancellation, purchase, expiry handling, and ledger transfers.
- A basic Persian RTL Mini App market screen.
- Basic Bot commands for squad, market, selling, buying, special catalog, and special packs.
- PostgreSQL Prisma schema includes preliminary Telegram group, membership, and group-challenge models.

### Important gaps and risks

1. **Bot-only onboarding is incomplete.** The current `/start` handler only sends a welcome message. Account creation is currently performed by `POST /v1/auth/telegram` using Mini App `initData`. A user who interacts only with the Bot is not provisioned before using account-dependent commands.
2. **The Bot currently uses long polling.** `bot.start()` is not the Cloudflare Workers webhook entry point. The Bot needs a webhook adapter and explicit Telegram webhook secret validation.
3. **The API is a Node/Fastify server.** `server.ts` calls `app.listen()`; it is not currently a Workers fetch handler. Do not assume it can be deployed unchanged as a Worker.
4. **The current API authorization is transport-specific.** Bot identity is accepted from a Telegram ID header when the shared secret matches. The Worker must validate Telegram's webhook secret before trusting the sender ID, and the shared secret must never reach the browser.
5. **Mini App coverage is narrow.** The current web client is essentially a market screen, not the full club-management game.
6. **Group gameplay is only a data-model starting point.** There are no complete group registration, challenge lifecycle, invitation/acceptance, scheduling, match resolution, standings, or reward flows.
7. **The match engine and competition lifecycle are absent.** No fixtures, match simulation, league tables, cups, seasons, or match-event history are implemented.
8. **Club operations are incomplete.** Stadium, facilities, academy, training, coaches, staff, morale/fitness recovery, contracts, wages, sponsorship, and recurring operating costs do not yet form a complete playable loop.
9. **Economy operations need a full domain design.** Daily settlement, sponsorship, ticketing, wages, maintenance, training costs, transfer fees, rewards, and administrative tuning need explicit ledger-backed services and idempotent schedules.
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

**Not yet complete:** These are foundation slices, not a complete playable game. Player development, contracts, injuries, club facilities, finance settlement, match simulation, competitions, full group lifecycle, complete Bot/Mini App parity, admin controls, and operational hardening remain open. No Cloudflare Worker, live webhook, production deployment, or real database provisioning has been performed.

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
- Add player development, training plans, morale, fitness, injury, and contract lifecycle.
- Add manager/coach profile and club progression.
- Ensure every action is available from both Bot and Mini App (with suitable UX for each).

**Exit criteria:** a new user can create and manage a club and squad using either client.

### Phase 2 — Club facilities and operations

- Stadium capacity, upgrades, ticket pricing, attendance, and match-day revenue.
- Training ground and academy progression.
- Coaches, staff, facilities, and upgrade costs.
- Sponsorship contracts and recurring income.
- Wages, maintenance, training expenses, contract renewals, and financial statements.
- A deterministic, idempotent daily settlement service.

**Exit criteria:** the club has a complete operating and progression loop with a traceable ledger.

### Phase 3 — Match engine and competitions

- Formation/tactics model and player-role compatibility.
- Deterministic match simulation with versioned rules and reproducible inputs.
- Match events, score, player performance, injuries, fatigue, and rewards.
- Fixtures, schedules, league tables, promotion/relegation, cups, and seasons.
- Match history and post-match reports in both clients.

**Exit criteria:** users can play a complete season and all outcomes/rewards are auditable and applied once.

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

At commit `daa2b124a03c6d61169f897c7bcee54fa705343a`, the PostgreSQL 16 ephemeral CI run applied all three migrations and the seed command upserted 15 special players. The job then failed because the verification command invoked `prisma db execute` without `--schema` or `--url`. This is a CI verification-command defect, not a migration or seed failure. Keep the correction for the later integration-validation phase.

## Scope and release guardrails

- Development target: `feat/foundation` (or a new feature branch created from it).
- No merge to `main`, no production deployment, and no live Telegram webhook changes without explicit approval.
- No use of the unrelated Tosan Supabase project as Football Empire storage.
- No real database migration/seed until a dedicated Football Empire development database is explicitly configured and approved.
