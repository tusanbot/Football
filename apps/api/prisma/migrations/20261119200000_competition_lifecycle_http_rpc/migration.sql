CREATE OR REPLACE FUNCTION public._start_competition_locked(p_competition_id text, p_now timestamptz, p_auto_start boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_comp public."Competition"%ROWTYPE; v_entries integer; v_valid integer; v_slots text[];
  v_size integer; v_rounds integer; v_round integer; v_pair integer; v_first text; v_second text;
  v_home text; v_away text; v_tie text; v_key text; v_leg integer; v_fixtures integer := 0;
  v_schedule timestamp(3); v_rules jsonb; v_existing_rounds integer;
BEGIN
  SELECT * INTO v_comp FROM public."Competition" WHERE id = p_competition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'COMPETITION_NOT_FOUND', ERRCODE = 'P0001'; END IF;
  IF v_comp.status::text <> 'REGISTRATION' THEN
    IF v_comp.status::text IN ('ACTIVE', 'COMPLETED') THEN
      SELECT count(*), COALESCE(max(round), 0) INTO v_fixtures, v_existing_rounds FROM public."FootballMatch" WHERE "competitionId" = p_competition_id;
      SELECT count(*) INTO v_entries FROM public."CompetitionEntry" WHERE "competitionId" = p_competition_id;
      RETURN jsonb_build_object('fixturesCreated', v_fixtures, 'rounds', v_existing_rounds, 'teams', v_entries, 'replayed', true);
    END IF;
    RAISE EXCEPTION USING MESSAGE = 'COMPETITION_NOT_OPEN', ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_entries FROM public."CompetitionEntry" WHERE "competitionId" = p_competition_id;
  IF v_comp.format::text = 'LEAGUE' AND v_entries < v_comp."maxTeams" THEN RAISE EXCEPTION USING MESSAGE = 'COMPETITION_WAITING_FOR_TEAMS', ERRCODE = 'P0001'; END IF;
  IF v_entries < 4 THEN RAISE EXCEPTION USING MESSAGE = 'LEAGUE_NEEDS_FOUR_TEAMS', ERRCODE = 'P0001'; END IF;
  IF v_comp.format::text = 'CUP' AND (v_comp."maxTeams" NOT IN (4, 8) OR v_entries <> v_comp."maxTeams") THEN
    RAISE EXCEPTION USING MESSAGE = 'CUP_REQUIRES_FULL_FOUR_OR_EIGHT_TEAM_BRACKET', ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_valid FROM public."CompetitionEntry" e
  WHERE e."competitionId" = p_competition_id
    AND (SELECT count(*) FROM public."Player" p WHERE p."clubId" = e."clubId" AND p.status::text = 'ACTIVE') >= 11
    AND EXISTS (SELECT 1 FROM public."Player" p WHERE p."clubId" = e."clubId" AND p.status::text = 'ACTIVE' AND p.position::text = 'GK');
  IF v_valid <> v_entries THEN RAISE EXCEPTION USING MESSAGE = 'ALL_TEAMS_NEED_VALID_LINEUPS', ERRCODE = 'P0001'; END IF;
  v_rules := COALESCE(v_comp.rules,
    CASE WHEN v_comp.format::text = 'CUP'
      THEN '{"maxSubstitutions":5,"maxInPlayWindows":3,"injuriesEnabled":true,"injuryDurationDays":5,"redCardSuspensionMatches":1,"yellowCardsToSuspend":3,"yellowCardSuspensionMatches":1,"penaltiesOnDraw":true}'::jsonb
      ELSE '{"maxSubstitutions":5,"maxInPlayWindows":3,"injuriesEnabled":true,"injuryDurationDays":5,"redCardSuspensionMatches":1,"yellowCardsToSuspend":3,"yellowCardSuspensionMatches":1,"penaltiesOnDraw":false}'::jsonb END);
  IF v_comp.format::text = 'CUP' THEN
    SELECT array_agg(e."clubId" ORDER BY e."joinedAt" ASC) INTO v_slots FROM public."CompetitionEntry" e WHERE e."competitionId" = p_competition_id;
    FOR v_pair IN 1..(v_entries / 2) LOOP
      v_home := v_slots[v_pair]; v_away := v_slots[v_entries - v_pair + 1]; v_tie := 'cup:' || v_comp.id || ':r1:t' || v_pair;
      FOR v_leg IN 1..v_comp."cupLegs" LOOP
        v_key := v_tie || ':leg' || v_leg;
        v_schedule := (((date_trunc('hour', (p_now + make_interval(days => v_leg * 3)) AT TIME ZONE 'Asia/Tehran')
          + CASE WHEN date_part('minute', (p_now + make_interval(days => v_leg * 3)) AT TIME ZONE 'Asia/Tehran') > 0
            OR date_part('second', (p_now + make_interval(days => v_leg * 3)) AT TIME ZONE 'Asia/Tehran') > 0
            THEN interval '1 hour' ELSE interval '0 hour' END) AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'UTC')::timestamp(3);
        INSERT INTO public."FootballMatch" (id, "idempotencyKey", type, "homeClubId", "awayClubId", "competitionId", round, "scheduledAt", seed, "rulesSnapshot", "tieId", leg, "createdAt", "updatedAt")
        VALUES ('match_' || replace(gen_random_uuid()::text, '-', ''), v_key, 'CUP',
          CASE WHEN v_leg = 1 THEN v_home ELSE v_away END, CASE WHEN v_leg = 1 THEN v_away ELSE v_home END,
          p_competition_id, 1, v_schedule, v_key, v_rules, CASE WHEN v_comp."cupLegs" = 2 THEN v_tie ELSE NULL END,
          v_leg, (p_now AT TIME ZONE 'UTC'), (p_now AT TIME ZONE 'UTC'));
        v_fixtures := v_fixtures + 1;
      END LOOP;
    END LOOP;
    SELECT min("scheduledAt") INTO v_schedule FROM public."FootballMatch" WHERE "competitionId" = p_competition_id;
    UPDATE public."Competition" SET status = 'ACTIVE', "startsAt" = v_schedule, "updatedAt" = (p_now AT TIME ZONE 'UTC') WHERE id = p_competition_id;
    RETURN jsonb_build_object('fixturesCreated', v_fixtures, 'rounds', floor(ln(v_entries) / ln(2))::integer, 'teams', v_entries, 'cupLegs', v_comp."cupLegs", 'replayed', false);
  END IF;
  IF p_auto_start THEN
    SELECT array_agg(x."clubId" ORDER BY x.rnd) INTO v_slots FROM (SELECT e."clubId", random() AS rnd FROM public."CompetitionEntry" e WHERE e."competitionId" = p_competition_id) x;
  ELSE
    SELECT array_agg(e."clubId" ORDER BY e."joinedAt" ASC) INTO v_slots FROM public."CompetitionEntry" e WHERE e."competitionId" = p_competition_id;
    SELECT array_agg(x.club_id ORDER BY x.rnd) INTO v_slots FROM (SELECT unnest(v_slots) AS club_id, random() AS rnd) x;
  END IF;
  v_size := cardinality(v_slots);
  IF v_size % 2 = 1 THEN v_slots := array_append(v_slots, ''); v_size := v_size + 1; END IF;
  v_rounds := v_size - 1;
  IF p_auto_start THEN
    v_schedule := (((date_trunc('hour', (p_now + interval '1 day') AT TIME ZONE 'Asia/Tehran')
      + CASE WHEN date_part('minute', (p_now + interval '1 day') AT TIME ZONE 'Asia/Tehran') > 0
        OR date_part('second', (p_now + interval '1 day') AT TIME ZONE 'Asia/Tehran') > 0
        THEN interval '1 hour' ELSE interval '0 hour' END) AT TIME ZONE 'Asia/Tehran') AT TIME ZONE 'UTC')::timestamp(3);
  ELSE v_schedule := ((p_now + interval '1 day') AT TIME ZONE 'UTC')::timestamp(3);
  END IF;
  FOR v_round IN 1..v_rounds LOOP
    FOR v_pair IN 1..(v_size / 2) LOOP
      v_first := v_slots[v_pair]; v_second := v_slots[v_size - v_pair + 1];
      IF v_first <> '' AND v_second <> '' THEN
        IF (v_round + v_pair) % 2 = 1 THEN v_home := v_second; v_away := v_first; ELSE v_home := v_first; v_away := v_second; END IF;
        v_key := 'league:' || v_comp.id || ':r' || v_round || ':' || v_home || ':' || v_away;
        INSERT INTO public."FootballMatch" (id, "idempotencyKey", type, "homeClubId", "awayClubId", "competitionId", round, "scheduledAt", seed, "rulesSnapshot", "createdAt", "updatedAt")
        VALUES ('match_' || replace(gen_random_uuid()::text, '-', ''), v_key, 'LEAGUE', v_home, v_away, p_competition_id,
          v_round, v_schedule + ((v_round - 1) * interval '1 day'), v_key, v_rules, (p_now AT TIME ZONE 'UTC'), (p_now AT TIME ZONE 'UTC'));
        v_fixtures := v_fixtures + 1;
      END IF;
    END LOOP;
    v_slots := ARRAY[v_slots[1], v_slots[v_size]] || v_slots[2:v_size - 1];
  END LOOP;
  UPDATE public."Competition" SET status = 'ACTIVE', "startsAt" = v_schedule, "updatedAt" = (p_now AT TIME ZONE 'UTC') WHERE id = p_competition_id;
  RETURN jsonb_build_object('fixturesCreated', v_fixtures, 'rounds', v_rounds, 'teams', v_entries,
    'startsAt', to_char(v_schedule, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'replayed', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.join_competition_http(p_user_id text, p_competition_id text, p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
DECLARE v_club_id text; v_comp public."Competition"%ROWTYPE; v_count integer; v_result jsonb;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' OR p_competition_id IS NULL OR btrim(p_competition_id) = '' OR p_now IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'INVALID_COMPETITION', ERRCODE = 'P0001'; END IF;
  SELECT c.id INTO v_club_id FROM public."Club" c WHERE c."ownerId" = p_user_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('competition-lifecycle:' || p_competition_id, 0));
  SELECT * INTO v_comp FROM public."Competition" WHERE id = p_competition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'COMPETITION_NOT_FOUND', ERRCODE = 'P0001'; END IF;
  SELECT count(*) INTO v_count FROM public."CompetitionEntry" WHERE "competitionId" = p_competition_id;
  IF EXISTS (SELECT 1 FROM public."CompetitionEntry" WHERE "competitionId" = p_competition_id AND "clubId" = v_club_id) THEN
    RETURN jsonb_build_object('joined', true, 'replayed', true, 'teams', v_count, 'autoStarted', v_comp.status::text = 'ACTIVE');
  END IF;
  IF v_comp.status::text <> 'REGISTRATION' THEN RAISE EXCEPTION USING MESSAGE = 'COMPETITION_NOT_OPEN', ERRCODE = 'P0001'; END IF;
  IF v_count >= v_comp."maxTeams" THEN RAISE EXCEPTION USING MESSAGE = 'COMPETITION_FULL', ERRCODE = 'P0001'; END IF;
  INSERT INTO public."CompetitionEntry" (id, "competitionId", "clubId", "joinedAt")
  VALUES ('competition_entry_' || replace(gen_random_uuid()::text, '-', ''), p_competition_id, v_club_id, (p_now AT TIME ZONE 'UTC'));
  v_count := v_count + 1;
  IF v_comp.format::text <> 'LEAGUE' OR v_count < v_comp."maxTeams" THEN
    RETURN jsonb_build_object('joined', true, 'replayed', false, 'teams', v_count, 'autoStarted', false, 'requiredTeams', v_comp."maxTeams");
  END IF;
  v_result := public._start_competition_locked(p_competition_id, p_now, true);
  RETURN v_result || jsonb_build_object('joined', true, 'replayed', false, 'autoStarted', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_competition_http(p_user_id text, p_competition_id text, p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
DECLARE v_club_id text; v_comp public."Competition"%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' OR p_competition_id IS NULL OR btrim(p_competition_id) = '' OR p_now IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'INVALID_COMPETITION', ERRCODE = 'P0001'; END IF;
  SELECT c.id INTO v_club_id FROM public."Club" c WHERE c."ownerId" = p_user_id LIMIT 1;
  IF v_club_id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('competition-lifecycle:' || p_competition_id, 0));
  SELECT * INTO v_comp FROM public."Competition" WHERE id = p_competition_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'COMPETITION_NOT_FOUND', ERRCODE = 'P0001'; END IF;
  IF v_comp."createdByClubId" <> v_club_id THEN RAISE EXCEPTION USING MESSAGE = 'ONLY_CREATOR_CAN_START', ERRCODE = 'P0001'; END IF;
  RETURN public._start_competition_locked(p_competition_id, p_now, false);
END;
$function$;

REVOKE ALL ON FUNCTION public._start_competition_locked(text, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.join_competition_http(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_competition_http(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public._start_competition_locked(text, timestamptz, boolean) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.join_competition_http(text, text, timestamptz) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.start_competition_http(text, text, timestamptz) TO service_role';
  END IF;
END;
$grant$;
