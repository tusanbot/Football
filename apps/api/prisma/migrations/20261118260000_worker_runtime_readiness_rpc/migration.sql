-- Read-only schema and privilege readiness probe for the HTTPS Worker runtime.
CREATE OR REPLACE FUNCTION public.football_runtime_readiness()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT
    (
      SELECT count(*) = 10
      FROM public."_prisma_migrations"
      WHERE migration_name IN (
        '20261116120000_in_game_store',
        '20261117100000_lock_down_public_api',
        '20261117110000_index_foreign_key_columns',
        '20261117120000_restore_alliance_foreign_keys',
        '20261117180000_event_tournaments',
        '20261117200000_match_lifecycle_notifications',
        '20261117210000_league_round_notice_dedupe',
        '20261117220000_event_tournament_competitions',
        '20261117230000_event_tournament_default_capacity',
        '20261117240000_event_tournament_fk_indexes'
      )
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    )
    AND to_regclass('public."PyramidLeague"') IS NOT NULL
    AND to_regclass('public."LeaguePromotionOffer"') IS NOT NULL
    AND to_regclass('public."EventTournament"') IS NOT NULL
    AND to_regclass('public."EventTournamentParticipant"') IS NOT NULL
    AND to_regclass('public."EventTournamentPrize"') IS NOT NULL
    AND to_regclass('public."EventTournamentPrizeAward"') IS NOT NULL
    AND to_regclass('public."MatchLifecycleNotification"') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'LeagueNotice'
        AND column_name = 'dedupeKey'
    )
    AND (SELECT count(*) >= 15 FROM public."SpecialPlayer" WHERE active = true)
    AND EXISTS (
      SELECT 1 FROM pg_roles
      WHERE rolname = current_user
        AND (rolsuper OR rolbypassrls)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT c.relrowsecurity
    )
    AND NOT EXISTS (
      SELECT 1
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND grantee IN ('anon', 'authenticated')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'S'
        AND (
          has_sequence_privilege('anon', c.oid, 'USAGE')
          OR has_sequence_privilege('anon', c.oid, 'SELECT')
          OR has_sequence_privilege('anon', c.oid, 'UPDATE')
          OR has_sequence_privilege('authenticated', c.oid, 'USAGE')
          OR has_sequence_privilege('authenticated', c.oid, 'SELECT')
          OR has_sequence_privilege('authenticated', c.oid, 'UPDATE')
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND (
          has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.football_runtime_readiness() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.football_runtime_readiness() TO service_role;
