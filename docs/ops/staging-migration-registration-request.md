# Football Empire Staging readiness

## Database migration state

- All 42 Prisma SQL migration files from this release branch are already applied to the isolated `Football Empire Staging` Supabase project.
- Supabase's migration ledger contains 42 applied entries.
- The Prisma `public."_prisma_migrations"` ledger has now been initialized with all 42 migration names and SHA-256 checksums calculated from the exact files in release commit `6867b44e7055fb802df6956c7eb90558be6dd412`.
- Verification confirmed 42 unique records, all marked finished, with no rolled-back entries and no malformed checksums.
- The Prisma migration ledger has RLS enabled. Browser-facing roles have no grants; the runtime role has read access for API readiness checks.
- No SQL migration was re-executed during ledger registration.

## Staging deployment

- GitHub Actions does not need a direct PostgreSQL connection. The API Worker connects through the isolated `footballtest` Hyperdrive binding.
- The staging deploy workflow builds Prisma Client but does not run Prisma migration status or seed commands from the GitHub runner.
- The 15 curated special-player records were already provisioned and verified in Staging.
- The test Bot Worker may be deployed for health checks, but its Cron trigger is disabled and no Telegram webhook is registered. It remains dormant until separately authorized.

This document records the staging preparation state. The next commit marker `[deploy-staging]` requests deployment of the three staging Workers only; it does not authorize production deployment, webhook registration, or Bot activation.
