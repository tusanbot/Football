BEGIN;
SET LOCAL TIME ZONE 'Pacific/Honolulu';
DO $test$
DECLARE
  v_users text[] := ARRAY['ci-life-user-1','ci-life-user-2','ci-life-user-3','ci-life-user-4'];
  v_clubs text[] := ARRAY['ci-life-club-1','ci-life-club-2','ci-life-club-3','ci-life-club-4'];
  v_rules_league jsonb := '{"maxSubstitutions":5,"maxInPlayWindows":3,"injuriesEnabled":true,"injuryDurationDays":5,"redCardSuspensionMatches":1,"yellowCardsToSuspend":3,"yellowCardSuspensionMatches":1,"penaltiesOnDraw":false}'::jsonb;
  v_rules_cup jsonb := '{"maxSubstitutions":5,"maxInPlayWindows":3,"injuriesEnabled":true,"injuryDurationDays":5,"redCardSuspensionMatches":1,"yellowCardsToSuspend":3,"yellowCardSuspensionMatches":1,"penaltiesOnDraw":true}'::jsonb;
  v_now timestamptz := '2026-11-19T12:34:56.789Z'::timestamptz;
  v_result jsonb; v_league_id text; v_cup_id text; v_count integer; v_message text;
BEGIN
  INSERT INTO public."User" (id, "telegramId", "updatedAt")
  SELECT v_users[i], 'ci-life-tg-' || i, v_now AT TIME ZONE 'UTC' FROM generate_subscripts(v_users, 1) i ON CONFLICT (id) DO NOTHING;
  INSERT INTO public."Club" (id, "ownerId", name, slug, "updatedAt")
  SELECT v_clubs[i], v_users[i], 'CI Life Club ' || i, 'ci-life-club-' || i, v_now AT TIME ZONE 'UTC'
  FROM generate_subscripts(v_clubs, 1) i ON CONFLICT (id) DO NOTHING;
  INSERT INTO public."Player" (id, "clubId", "firstName", "lastName", nationality, age, position, overall, potential, attributes, wage, "contractDays", "lineupSlot", "updatedAt")
  SELECT 'ci-life-player-' || c || '-' || p, v_clubs[c], 'Player', p::text, 'IR', 25,
    CASE WHEN p = 11 THEN 'GK'::"PlayerPosition" ELSE 'CB'::"PlayerPosition" END,
    60, 65, '{}'::jsonb, 10, 365, p, v_now AT TIME ZONE 'UTC'
  FROM generate_subscripts(v_clubs, 1) c CROSS JOIN generate_series(1, 11) p ON CONFLICT (id) DO NOTHING;

  v_result := public.create_competition_http(v_users[1], 'CI Lifecycle League', 4, 'ci-life-league-create-key-01', 'LEAGUE', 1, 2026, v_rules_league, v_now);
  v_league_id := v_result->'competition'->>'id';
  v_result := public.update_competition_rules_http(v_users[1], v_league_id, '{"maxSubstitutions":4,"maxInPlayWindows":2,"injuriesEnabled":true,"injuryDurationDays":6,"redCardSuspensionMatches":2,"yellowCardsToSuspend":4,"yellowCardSuspensionMatches":2,"penaltiesOnDraw":false}'::jsonb, v_now);
  IF v_result->>'competitionId' <> v_league_id OR v_result->'rules'->>'maxSubstitutions' <> '4' THEN RAISE EXCEPTION 'rules update mismatch: %', v_result; END IF;
  BEGIN
    PERFORM public.update_competition_rules_http(v_users[2], v_league_id, v_rules_league, v_now);
    RAISE EXCEPTION 'expected ONLY_CREATOR_CAN_START';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT; IF v_message <> 'ONLY_CREATOR_CAN_START' THEN RAISE; END IF;
  END;
  INSERT INTO public."CompetitionEntry" (id, "competitionId", "clubId", "joinedAt")
  VALUES ('ci-life-entry-2', v_league_id, v_clubs[2], (v_now AT TIME ZONE 'UTC') + interval '1 second'),
         ('ci-life-entry-3', v_league_id, v_clubs[3], (v_now AT TIME ZONE 'UTC') + interval '2 seconds');
  v_result := public.join_competition_http(v_users[4], v_league_id, v_now);
  IF v_result->>'joined' <> 'true' OR v_result->>'autoStarted' <> 'true' OR (v_result->>'fixturesCreated')::integer <> 6 OR (v_result->>'rounds')::integer <> 3 THEN
    RAISE EXCEPTION 'league final join did not atomically auto-start a 4-team league: %', v_result;
  END IF;
  SELECT count(*) INTO v_count FROM public."FootballMatch" WHERE "competitionId" = v_league_id;
  IF v_count <> 6 OR (SELECT status::text FROM public."Competition" WHERE id = v_league_id) <> 'ACTIVE' THEN RAISE EXCEPTION 'league fixtures or activation mismatch'; END IF;
  v_result := public.join_competition_http(v_users[4], v_league_id, v_now);
  IF v_result->>'replayed' <> 'true' OR v_result->>'teams' <> '4' THEN RAISE EXCEPTION 'repeat join was not idempotent'; END IF;

  v_result := public.create_competition_http(v_users[1], 'CI Lifecycle Cup', 4, 'ci-life-cup-create-key-0001', 'CUP', 2, 2026, v_rules_cup, v_now);
  v_cup_id := v_result->'competition'->>'id';
  INSERT INTO public."CompetitionEntry" (id, "competitionId", "clubId", "joinedAt")
  VALUES ('ci-life-cup-entry-2', v_cup_id, v_clubs[2], (v_now AT TIME ZONE 'UTC') + interval '1 second'),
         ('ci-life-cup-entry-3', v_cup_id, v_clubs[3], (v_now AT TIME ZONE 'UTC') + interval '2 seconds'),
         ('ci-life-cup-entry-4', v_cup_id, v_clubs[4], (v_now AT TIME ZONE 'UTC') + interval '3 seconds');
  v_result := public.start_competition_http(v_users[1], v_cup_id, v_now);
  IF v_result->>'replayed' <> 'false' OR (v_result->>'fixturesCreated')::integer <> 4 OR (v_result->>'rounds')::integer <> 2 OR v_result->>'cupLegs' <> '2' THEN RAISE EXCEPTION 'two-leg cup start result mismatch: %', v_result; END IF;
  SELECT count(*) INTO v_count FROM public."FootballMatch" WHERE "competitionId" = v_cup_id;
  IF v_count <> 4 OR (SELECT count(*) FROM public."FootballMatch" WHERE "competitionId" = v_cup_id AND "tieId" IS NOT NULL AND leg IN (1,2)) <> 4 THEN RAISE EXCEPTION 'cup tie/leg fixture metadata mismatch'; END IF;
  v_result := public.start_competition_http(v_users[1], v_cup_id, v_now);
  IF v_result->>'replayed' <> 'true' OR (v_result->>'fixturesCreated')::integer <> 4 THEN RAISE EXCEPTION 'cup start replay mismatch'; END IF;
  BEGIN
    PERFORM public.start_competition_http(v_users[2], v_cup_id, v_now);
    RAISE EXCEPTION 'expected ONLY_CREATOR_CAN_START';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT; IF v_message <> 'ONLY_CREATOR_CAN_START' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.update_competition_rules_http(v_users[1], v_cup_id, v_rules_cup, v_now);
    RAISE EXCEPTION 'expected COMPETITION_RULES_LOCKED';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT; IF v_message <> 'COMPETITION_RULES_LOCKED' THEN RAISE; END IF;
  END;
END;
$test$;
ROLLBACK;
