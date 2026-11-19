-- Read-only dashboard projection for the Cloudflare Supabase HTTP runtime.
CREATE OR REPLACE FUNCTION public.get_game_dashboard(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  user_row public."User"%ROWTYPE;
  club_row public."Club"%ROWTYPE;
  active_competition jsonb;
  wallet_rows jsonb;
BEGIN
  SELECT * INTO user_row FROM public."User" WHERE id = p_user_id;
  IF NOT FOUND OR user_row."isSuspended" THEN
    RAISE EXCEPTION USING MESSAGE = 'USER_NOT_FOUND', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO club_row FROM public."Club" WHERE "ownerId" = p_user_id;
  active_competition := NULL;
  IF FOUND THEN
    SELECT jsonb_build_object('id', c.id, 'name', c.name) INTO active_competition
    FROM public."CompetitionEntry" ce
    JOIN public."Competition" c ON c.id = ce."competitionId"
    WHERE ce."clubId" = club_row.id AND c.status = 'ACTIVE'
    ORDER BY c."createdAt" DESC LIMIT 1;
    IF active_competition IS NULL THEN
      SELECT jsonb_build_object('id', c.id, 'name', c.name) INTO active_competition
      FROM public."PyramidLeagueEntry" ple
      JOIN public."PyramidLeague" pl ON pl.id = ple."leagueId"
      JOIN public."Competition" c ON c.id = pl."competitionId"
      WHERE ple."clubId" = club_row.id AND c.status = 'ACTIVE'
      ORDER BY c."createdAt" DESC LIMIT 1;
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'asset', w.asset::text, 'balance', w.balance::text, 'version', w.version
  ) ORDER BY w.asset), '[]'::jsonb) INTO wallet_rows
  FROM public."Wallet" w WHERE w."userId" = p_user_id;

  RETURN jsonb_build_object(
    'user', jsonb_build_object(
      'id', user_row.id, 'telegramId', user_row."telegramId", 'username', user_row.username,
      'displayName', user_row."displayName", 'createdAt', user_row."createdAt"
    ),
    'club', CASE WHEN club_row.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', club_row.id, 'name', club_row.name, 'level', club_row.level,
      'reputation', club_row.reputation, 'createdAt', club_row."createdAt",
      'activeCompetition', active_competition
    ) END,
    'wallets', wallet_rows
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_game_dashboard(text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_game_dashboard(text) TO service_role';
  END IF;
END;
$grant$;
