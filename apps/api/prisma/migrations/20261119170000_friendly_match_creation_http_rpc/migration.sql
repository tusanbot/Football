-- Atomically create a friendly match through the Supabase HTTP runtime.
CREATE OR REPLACE FUNCTION public.create_friendly_match_http(
  p_user_id text,
  p_opponent_club_id text,
  p_idempotency_key text,
  p_scheduled_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_home_club_id text;
  v_existing public."FootballMatch"%ROWTYPE;
  v_match public."FootballMatch"%ROWTYPE;
  v_club_id text;
  v_lock_ids text[];
  v_rules jsonb := '{"maxSubstitutions":5,"maxInPlayWindows":3,"injuriesEnabled":true,"injuryDurationDays":5,"redCardSuspensionMatches":1,"yellowCardsToSuspend":3,"yellowCardSuspensionMatches":1,"penaltiesOnDraw":false}'::jsonb;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_USER', ERRCODE = 'P0001';
  END IF;
  IF p_opponent_club_id IS NULL OR btrim(p_opponent_club_id) = '' THEN
    RAISE EXCEPTION USING MESSAGE = 'OPPONENT_NOT_FOUND', ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{12,128}$' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_IDEMPOTENCY_KEY', ERRCODE = 'P0001';
  END IF;
  IF p_scheduled_at IS NULL OR p_scheduled_at < now() - interval '1 minute'
    OR p_scheduled_at > now() + interval '30 days' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_MATCH_SCHEDULE', ERRCODE = 'P0001';
  END IF;

  SELECT c.id INTO v_home_club_id
  FROM public."Club" c WHERE c."ownerId" = p_user_id LIMIT 1;
  IF v_home_club_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001';
  END IF;
  IF v_home_club_id = p_opponent_club_id THEN
    RAISE EXCEPTION USING MESSAGE = 'MATCH_TEAMS_MUST_DIFFER', ERRCODE = 'P0001';
  END IF;

  -- Lock each club independently so concurrent fixtures cannot bypass overlap checks.
  v_lock_ids := ARRAY[v_home_club_id, p_opponent_club_id];
  SELECT array_agg(x ORDER BY x) INTO v_lock_ids FROM unnest(v_lock_ids) AS x;
  FOREACH v_club_id IN ARRAY v_lock_ids LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('friendly-match-club:' || v_club_id, 0));
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('friendly-match-key:' || p_idempotency_key, 0));

  SELECT m.* INTO v_existing FROM public."FootballMatch" m
  WHERE m."idempotencyKey" = p_idempotency_key LIMIT 1;
  IF FOUND THEN
    IF v_existing."homeClubId" <> v_home_club_id OR v_existing."awayClubId" <> p_opponent_club_id
      OR v_existing.type::text <> 'FRIENDLY' THEN
      RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT', ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('match', to_jsonb(v_existing), 'replayed', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public."Club" c WHERE c.id = p_opponent_club_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'OPPONENT_NOT_FOUND', ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."FootballMatch" m
    WHERE m.status::text IN ('SCHEDULED', 'IN_PROGRESS')
      AND m."scheduledAt" BETWEEN p_scheduled_at - interval '2 hours' AND p_scheduled_at + interval '2 hours'
      AND (m."homeClubId" IN (v_home_club_id, p_opponent_club_id)
        OR m."awayClubId" IN (v_home_club_id, p_opponent_club_id))
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'CLUB_ALREADY_HAS_MATCH_IN_WINDOW', ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[v_home_club_id, p_opponent_club_id]) AS clubs(club_id)
    WHERE (SELECT count(*) FROM public."Player" p
      WHERE p."clubId" = clubs.club_id AND p.status::text = 'ACTIVE'
        AND p."suspensionMatchesRemaining" = 0) < 11
    OR NOT EXISTS (SELECT 1 FROM public."Player" keeper
      WHERE keeper."clubId" = clubs.club_id AND keeper.status::text = 'ACTIVE'
        AND keeper."suspensionMatchesRemaining" = 0 AND keeper.position::text = 'GK')
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'BOTH_CLUBS_NEED_VALID_LINEUPS', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public."FootballMatch" (
    id, "idempotencyKey", type, status, "homeClubId", "awayClubId", "scheduledAt",
    seed, "rulesSnapshot", "createdAt", "updatedAt"
  ) VALUES (
    'match_' || replace(gen_random_uuid()::text, '-', ''),
    p_idempotency_key, 'FRIENDLY', 'SCHEDULED', v_home_club_id, p_opponent_club_id,
    p_scheduled_at, p_idempotency_key || ':' || gen_random_uuid()::text,
    v_rules, now(), now()
  )
  RETURNING * INTO v_match;
  RETURN jsonb_build_object('match', to_jsonb(v_match), 'replayed', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_friendly_match_http(text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_friendly_match_http(text, text, text, timestamptz) TO service_role';
  END IF;
END;
$grant$;
