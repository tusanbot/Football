# Supabase PostgreSQL — approved architecture

## Binding decision

Football Empire uses **Supabase PostgreSQL independently**. Prisma and Cloudflare Hyperdrive are not approved anywhere in the bot, API, Mini App, persistence, schema management, or deployment architecture.

- The API is the only application tier that connects to Supabase, using the PostgreSQL `pg` driver and server-only credentials.
- Telegram Bot and Mini App call the same authenticated API. Neither client connects directly to Supabase or receives database credentials.
- Use reviewed, Supabase-native SQL migrations as the schema source of truth.
- Do not add Prisma packages, Prisma schema/client/CLI, Prisma migrations, Hyperdrive, or database access through a Cloudflare Worker.
- Keep non-production and production Supabase projects separate.

## Migration status

This document records the approved target architecture; it does not claim that the existing repository has already completed the conversion. The current codebase still contains legacy Prisma-based persistence and migration artifacts. They must be migrated to direct `pg` access and Supabase-native SQL migrations, then removed, before the repository can be called Prisma-free.

Until that work is verified, do not add new features using the legacy Prisma layer, do not run Prisma commands, and do not claim full migration or production readiness.

## Security boundaries

- Keep Supabase connection credentials on the API/server only; never use `NEXT_PUBLIC_*` variables for secrets.
- Do not expose game tables to direct browser access. All game reads and writes pass through the authenticated API.
- Do not treat client-side Row Level Security as a replacement for API authorization.
- Use dedicated credentials and rotate them if exposed.
- Do not point development tests or CI at production data.

## Migration and verification requirements

The migration from the legacy persistence layer must:

1. Inventory existing schema, constraints, indexes, triggers, transaction boundaries, and all Prisma-dependent services.
2. Convert schema changes to reviewed Supabase-native SQL migrations without losing data or constraints.
3. Replace Prisma Client usage with parameterized `pg` queries and explicit transaction handling.
4. Preserve idempotency, concurrency protection, ledger atomicity, and existing API contracts.
5. Remove Prisma packages, generated artifacts, schema/migration directories, scripts, and obsolete environment variables only after all call sites are converted.
6. Update CI, setup instructions, deployment documentation, and tests so no Prisma or Hyperdrive path remains.
7. Verify typecheck, unit/integration tests, migration application against a disposable Supabase-compatible PostgreSQL database, and both Bot/Mini App flows before declaring the conversion complete.

No production database migration, data cutover, or deployment is implied by this architecture decision.
