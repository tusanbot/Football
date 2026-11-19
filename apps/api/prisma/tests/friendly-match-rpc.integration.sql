-- Integration tests for friendly-match creation, legacy lineup parity and UTC handling.
-- Run after migrations against an ephemeral PostgreSQL database.
BEGIN;
SET LOCAL TIME ZONE 'Pacific/Honolulu';

DO $test$
DECLARE
  v_home_user text := 'ci-friendly-home-user';
  v_away_user text := 'ci-friendly-away-user';
  v_bad_user text := 'ci-friendly-bad-user';
  v_home_club text := 'ci-friendly-home-club';
  v_away_club text := 'ci-friendly-away-club';
  v_bad_club text := 'ci-friendly-bad-club';
  v_scheduled_at timestamptz := now() + interval '1 day';
  v_result jsonb;
  v_stored_at timestamp(3);
  v_message text;
BEGIN
  INSERT INTO public."User" (id, "telegramId", "updatedAt") VALUES
    (v_home_user, 'ci-friendly-home-tg', now()),
    (v_away_user, 'ci-friendly-away-tg', now()),
    (v_bad_user, 'ci-friendly-bad-tg', now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public."Club" (id, "ownerId", name, slug, "updatedAt") VALUES
    (v_home_club, v_home_user, 'CI Friendly Home', 'ci-friendly-home', now()),
    (v_away_club, v_away_user, 'CI Friendly Away', 'ci-friendly-away', now()),
    (v_bad_club, v_bad_user, 'CI Friendly Bad', 'ci-friendly-bad', now())
  ON CONFLICT (id) DO NOTHING;

  -- Home has 11 non-GK starters and a reserve GK: legacy toSide replaces
  -- starter 11 with that keeper. Away has 10 starters and a reserve GK:
  -- legacy toSide appends the keeper to complete the starting XI.
  INSERT INTO public."Player" (
    id, "clubId", "firstName", "lastName", nationality, age, position,
    overall, potential, attributes, wage, "contractDays", "lineupSlot", "updatedAt"
  )
  SELECT 'ci-friendly-home-player-' || n, v_home_club, 'Home', n::text, 'IR', 25,
    'CB'::"PlayerPosition", 60, 65, '{}'::jsonb, 10, 365, n, now()
  FROM generate_series(1, 11) n
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public."Player" (
    id, "clubId", "firstName", "lastName", nationality, age, position,
    overall, potential, attributes, wage, "contractDays", "lineupSlot", "updatedAt"
  ) VALUES ('ci-friendly-home-keeper', v_home_club, 'Home', 'Keeper', 'IR', 25,
    'GK', 60, 65, '{}'::jsonb, 10, 365, NULL, now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public."Player" (
    id, "clubId", "firstName", "lastName", nationality, age, position,
    overall, potential, attributes, wage, "contractDays", "lineupSlot", "updatedAt"
  )
  SELECT 'ci-friendly-away-player-' || n, v_away_club, 'Away', n::text, 'IR', 25,
    'CB'::"PlayerPosition", 60, 65, '{}'::jsonb, 10, 365, n, now()
  FROM generate_series(1, 10) n
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public."Player" (
    id, "clubId", "firstName", "lastName", nationality, age, position,
    overall, potential, attributes, wage, "contractDays", "lineupSlot", "updatedAt"
  ) VALUES ('ci-friendly-away-keeper', v_away_club, 'Away', 'Keeper', 'IR', 25,
    'GK', 60, 65, '{}'::jsonb, 10, 365, NULL, now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public."Player" (
    id, "clubId", "firstName", "lastName", nationality, age, position,
    overall, potential, attributes, wage, "contractDays", "lineupSlot", "updatedAt"
  )
  SELECT 'ci-friendly-bad-player-' || n, v_bad_club, 'Bad', n::text, 'IR', 25,
    'CB'::"PlayerPosition", 50, 55, '{}'::jsonb, 10, 365, n, now()
  FROM generate_series(1, 10) n
  ON CONFLICT (id) DO NOTHING;

  v_result := public.create_friendly_match_http(
    v_home_user, v_away_club, 'ci-friendly-match-key-0001', v_scheduled_at
  );
  IF v_result->>'replayed' <> 'false' THEN
    RAISE EXCEPTION 'first friendly match creation was incorrectly marked replayed';
  END IF;
  IF v_result->'match'->>'scheduledAt' <>
    to_char((v_scheduled_at AT TIME ZONE 'UTC')::timestamp(3), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') THEN
    RAISE EXCEPTION 'friendly match RPC did not serialize the UTC scheduledAt instant';
  END IF;
  SELECT "scheduledAt" INTO v_stored_at FROM public."FootballMatch"
  WHERE "idempotencyKey" = 'ci-friendly-match-key-0001';
  IF v_stored_at <> (v_scheduled_at AT TIME ZONE 'UTC')::timestamp(3) THEN
    RAISE EXCEPTION 'friendly match RPC persisted scheduledAt using the session timezone';
  END IF;

  v_result := public.create_friendly_match_http(
    v_home_user, v_away_club, 'ci-friendly-match-key-0001', v_scheduled_at
  );
  IF v_result->>'replayed' <> 'true' THEN
    RAISE EXCEPTION 'friendly match idempotent replay was not detected';
  END IF;

  BEGIN
    PERFORM public.create_friendly_match_http(
      v_home_user, v_bad_club, 'ci-friendly-match-key-0001', v_scheduled_at
    );
    RAISE EXCEPTION 'expected IDEMPOTENCY_CONFLICT';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'IDEMPOTENCY_CONFLICT' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.create_friendly_match_http(
      v_home_user, v_away_club, 'ci-friendly-match-key-0002', v_scheduled_at + interval '1 hour'
    );
    RAISE EXCEPTION 'expected CLUB_ALREADY_HAS_MATCH_IN_WINDOW';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'CLUB_ALREADY_HAS_MATCH_IN_WINDOW' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.create_friendly_match_http(
      v_home_user, v_bad_club, 'ci-friendly-match-key-0003', v_scheduled_at + interval '1 day'
    );
    RAISE EXCEPTION 'expected BOTH_CLUBS_NEED_VALID_LINEUPS';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'BOTH_CLUBS_NEED_VALID_LINEUPS' THEN RAISE; END IF;
  END;
END;
$test$;

ROLLBACK;
