-- Preserve the Prisma timestamp-without-time-zone UTC convention and match the
-- legacy toSide selection algorithm exactly before accepting a friendly fixture.
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
  v_club record;
  v_player record;
  v_selected_ids text[];
  v_selected_positions text[];
  v_keeper_id text;
  v_scheduled_at timestamp(3);
  v_lock_ids text[];
  v_rules jsonb := '{"maxSubstitutions":5,"maxInPlayWindows":3,"injuriesEnabled":true,"injuryDurationDays":5,"redCardSuspensionMatches":1,"yellowCardsToSuspend":3,"yellowCardSuspensionMatches":1,"penaltiesOnDraw":false}'::jsonb;
  v_match_json jsonb;
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

  -- Prisma DateTime columns are timestamp(3) without time zone. All app Date
  -- values are UTC instants, so persist the UTC wall-clock representation.
  v_scheduled_at := (p_scheduled_at AT TIME ZONE 'UTC')::timestamp(3);

  SELECT c.id INTO v_home_club_id
  FROM public."Club" c WHERE c."ownerId" = p_user_id LIMIT 1;
  IF v_home_club_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001';
  END IF;
  IF v_home_club_id = p_opponent_club_id THEN
    RAISE EXCEPTION USING MESSAGE = 'MATCH_TEAMS_MUST_DIFFER', ERRCODE = 'P0001';
  END IF;

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
    v_match_json := to_jsonb(v_existing) || jsonb_build_object(
      'scheduledAt', to_char(v_existing."scheduledAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'startedAt', CASE WHEN v_existing."startedAt" IS NULL THEN NULL ELSE to_char(v_existing."startedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'completedAt', CASE WHEN v_existing."completedAt" IS NULL THEN NULL ELSE to_char(v_existing."completedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'createdAt', to_char(v_existing."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', to_char(v_existing."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
    RETURN jsonb_build_object('match', v_match_json, 'replayed', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public."Club" c WHERE c.id = p_opponent_club_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'OPPONENT_NOT_FOUND', ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."FootballMatch" m
    WHERE m.status::text IN ('SCHEDULED', 'IN_PROGRESS')
      AND m."scheduledAt" BETWEEN v_scheduled_at - interval '2 hours' AND v_scheduled_at + interval '2 hours'
      AND (m."homeClubId" IN (v_home_club_id, p_opponent_club_id)
        OR m."awayClubId" IN (v_home_club_id, p_opponent_club_id))
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'CLUB_ALREADY_HAS_MATCH_IN_WINDOW', ERRCODE = 'P0001';
  END IF;

  -- Reproduce match-service.ts toSide(): starters ordered by lineupSlot;
  -- if they contain no GK, replace starter 11 with the best reserve GK (or
  -- append one when fewer than 11 starters); then fill from the ordered bench.
  FOR v_club IN
    SELECT c.id FROM public."Club" c WHERE c.id IN (v_home_club_id, p_opponent_club_id)
  LOOP
    SELECT
      COALESCE(array_agg(p.id ORDER BY p."lineupSlot" ASC), ARRAY[]::text[]),
      COALESCE(array_agg(p.position::text ORDER BY p."lineupSlot" ASC), ARRAY[]::text[])
    INTO v_selected_ids, v_selected_positions
    FROM public."Player" p
    WHERE p."clubId" = v_club.id AND p.status::text = 'ACTIVE'
      AND p."suspensionMatchesRemaining" = 0 AND p."lineupSlot" IS NOT NULL;

    IF NOT ('GK' = ANY(v_selected_positions)) THEN
      SELECT p.id INTO v_keeper_id
      FROM public."Player" p
      WHERE p."clubId" = v_club.id AND p.status::text = 'ACTIVE'
        AND p."suspensionMatchesRemaining" = 0 AND p."lineupSlot" IS NULL
        AND p.position::text = 'GK'
      ORDER BY p.overall DESC, p.id ASC
      LIMIT 1;

      IF v_keeper_id IS NOT NULL THEN
        IF cardinality(v_selected_ids) >= 11 THEN
          v_selected_ids[11] := v_keeper_id;
          v_selected_positions[11] := 'GK';
        ELSE
          v_selected_ids := array_append(v_selected_ids, v_keeper_id);
          v_selected_positions := array_append(v_selected_positions, 'GK');
        END IF;
      END IF;
    END IF;

    FOR v_player IN
      SELECT p.id, p.position::text AS position
      FROM public."Player" p
      WHERE p."clubId" = v_club.id AND p.status::text = 'ACTIVE'
        AND p."suspensionMatchesRemaining" = 0 AND p."lineupSlot" IS NULL
      ORDER BY p.overall DESC, p.id ASC
    LOOP
      EXIT WHEN cardinality(v_selected_ids) >= 11;
      IF NOT (v_player.id = ANY(v_selected_ids)) THEN
        v_selected_ids := array_append(v_selected_ids, v_player.id);
        v_selected_positions := array_append(v_selected_positions, v_player.position);
      END IF;
    END LOOP;

    IF cardinality(v_selected_ids[1:11]) <> 11 OR NOT ('GK' = ANY(v_selected_positions[1:11])) THEN
      RAISE EXCEPTION USING MESSAGE = 'BOTH_CLUBS_NEED_VALID_LINEUPS', ERRCODE = 'P0001';
    END IF;
  END LOOP;

  INSERT INTO public."FootballMatch" (
    id, "idempotencyKey", type, status, "homeClubId", "awayClubId", "scheduledAt",
    seed, "rulesSnapshot", "createdAt", "updatedAt"
  ) VALUES (
    'match_' || replace(gen_random_uuid()::text, '-', ''),
    p_idempotency_key, 'FRIENDLY', 'SCHEDULED', v_home_club_id, p_opponent_club_id,
    v_scheduled_at, p_idempotency_key || ':' || gen_random_uuid()::text,
    v_rules, now(), now()
  )
  RETURNING * INTO v_match;

  v_match_json := to_jsonb(v_match) || jsonb_build_object(
    'scheduledAt', to_char(v_match."scheduledAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'startedAt', CASE WHEN v_match."startedAt" IS NULL THEN NULL ELSE to_char(v_match."startedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'completedAt', CASE WHEN v_match."completedAt" IS NULL THEN NULL ELSE to_char(v_match."completedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'createdAt', to_char(v_match."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(v_match."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  RETURN jsonb_build_object('match', v_match_json, 'replayed', false);
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
