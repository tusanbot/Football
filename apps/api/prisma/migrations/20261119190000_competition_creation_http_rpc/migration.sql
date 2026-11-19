CREATE OR REPLACE FUNCTION public.create_competition_http(
  p_user_id text,
  p_name text,
  p_max_teams integer,
  p_idempotency_key text,
  p_format text,
  p_cup_legs integer,
  p_season integer,
  p_rules jsonb,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_club_id text;
  v_existing public."Competition"%ROWTYPE;
  v_competition public."Competition"%ROWTYPE;
  v_entry_id text;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_USER', ERRCODE = 'P0001';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 3 AND 40 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_COMPETITION', ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{12,128}$' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_IDEMPOTENCY_KEY', ERRCODE = 'P0001';
  END IF;
  IF p_format NOT IN ('LEAGUE', 'CUP') OR p_season < 2000 OR p_season > 3000 OR p_now IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_COMPETITION', ERRCODE = 'P0001';
  END IF;
  IF p_format = 'LEAGUE' AND (p_max_teams < 4 OR p_max_teams > 10 OR p_cup_legs <> 1) THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_LEAGUE_SIZE', ERRCODE = 'P0001';
  END IF;
  IF p_format = 'CUP' AND (p_max_teams NOT IN (4, 8) OR p_cup_legs NOT IN (1, 2)) THEN
    RAISE EXCEPTION USING MESSAGE = 'CUP_SIZE_MUST_BE_FOUR_OR_EIGHT', ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_rules) <> 'object'
    OR jsonb_typeof(p_rules->'maxSubstitutions') <> 'number'
    OR jsonb_typeof(p_rules->'maxInPlayWindows') <> 'number'
    OR jsonb_typeof(p_rules->'injuriesEnabled') <> 'boolean'
    OR jsonb_typeof(p_rules->'injuryDurationDays') <> 'number'
    OR jsonb_typeof(p_rules->'redCardSuspensionMatches') <> 'number'
    OR jsonb_typeof(p_rules->'yellowCardsToSuspend') <> 'number'
    OR jsonb_typeof(p_rules->'yellowCardSuspensionMatches') <> 'number'
    OR jsonb_typeof(p_rules->'penaltiesOnDraw') <> 'boolean'
    OR (p_rules->>'maxSubstitutions')::integer NOT BETWEEN 0 AND 5
    OR (p_rules->>'maxInPlayWindows')::integer NOT BETWEEN 0 AND 3
    OR (p_rules->>'injuryDurationDays')::integer NOT BETWEEN 1 AND 14
    OR (p_rules->>'redCardSuspensionMatches')::integer NOT BETWEEN 0 AND 5
    OR (p_rules->>'yellowCardsToSuspend')::integer NOT BETWEEN 0 AND 10
    OR (p_rules->>'yellowCardSuspensionMatches')::integer NOT BETWEEN 0 AND 5
    OR (p_rules->>'maxInPlayWindows')::integer > (p_rules->>'maxSubstitutions')::integer
    OR (p_format = 'LEAGUE' AND (p_rules->>'penaltiesOnDraw')::boolean)
    OR (p_format = 'CUP' AND NOT (p_rules->>'penaltiesOnDraw')::boolean) THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_COMPETITION_RULES', ERRCODE = 'P0001';
  END IF;

  SELECT c.id INTO v_club_id
  FROM public."Club" c
  WHERE c."ownerId" = p_user_id
  LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('competition-create:' || p_idempotency_key, 0));
  SELECT c.* INTO v_existing FROM public."Competition" c
  WHERE c."idempotencyKey" = p_idempotency_key LIMIT 1;
  IF FOUND THEN
    IF v_existing."createdByClubId" <> v_club_id
      OR v_existing.name <> btrim(p_name)
      OR v_existing."maxTeams" <> p_max_teams
      OR v_existing.format::text <> p_format
      OR v_existing."cupLegs" <> p_cup_legs THEN
      RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT', ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('competition', to_jsonb(v_existing), 'replayed', true);
  END IF;

  INSERT INTO public."Competition" (
    id, "idempotencyKey", name, season, format, status, "maxTeams", "cupLegs",
    rules, "createdByClubId", "createdAt", "updatedAt"
  ) VALUES (
    'competition_' || replace(gen_random_uuid()::text, '-', ''),
    p_idempotency_key, btrim(p_name), p_season, p_format::"CompetitionFormat",
    'REGISTRATION', p_max_teams, p_cup_legs, p_rules, v_club_id,
    (p_now AT TIME ZONE 'UTC'), (p_now AT TIME ZONE 'UTC')
  )
  RETURNING * INTO v_competition;

  INSERT INTO public."CompetitionEntry" (
    id, "competitionId", "clubId", "joinedAt"
  ) VALUES (
    'competition_entry_' || replace(gen_random_uuid()::text, '-', ''),
    v_competition.id, v_club_id, (p_now AT TIME ZONE 'UTC')
  );

  RETURN jsonb_build_object('competition', to_jsonb(v_competition), 'replayed', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_competition_http(text, text, integer, text, text, integer, integer, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_competition_http(text, text, integer, text, text, integer, integer, jsonb, timestamptz) TO service_role';
  END IF;
END;
$grant$;
