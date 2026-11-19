-- Integration tests for competition creation RPC. Runs entirely in an ephemeral CI DB.
BEGIN;
SET LOCAL TIME ZONE 'America/Los_Angeles';

DO $test$
DECLARE
  v_user text := 'ci-competition-owner';
  v_other_user text := 'ci-competition-other';
  v_club text := 'ci-competition-club';
  v_other_club text := 'ci-competition-other-club';
  v_now timestamptz := '2026-11-19T12:34:56.789Z'::timestamptz;
  v_rules jsonb := '{"maxSubstitutions":5,"maxInPlayWindows":3,"injuriesEnabled":true,"injuryDurationDays":5,"redCardSuspensionMatches":1,"yellowCardsToSuspend":3,"yellowCardSuspensionMatches":1,"penaltiesOnDraw":false}'::jsonb;
  v_result jsonb;
  v_competition_id text;
  v_entry_count integer;
  v_message text;
BEGIN
  INSERT INTO public."User" (id, "telegramId", "updatedAt") VALUES
    (v_user, 'ci-competition-owner-tg', v_now AT TIME ZONE 'UTC'),
    (v_other_user, 'ci-competition-other-tg', v_now AT TIME ZONE 'UTC')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public."Club" (id, "ownerId", name, slug, "updatedAt") VALUES
    (v_club, v_user, 'CI Competition Club', 'ci-competition-club', v_now AT TIME ZONE 'UTC'),
    (v_other_club, v_other_user, 'CI Other Club', 'ci-competition-other-club', v_now AT TIME ZONE 'UTC')
  ON CONFLICT (id) DO NOTHING;

  v_result := public.create_competition_http(
    v_user, 'CI Test League', 8, 'ci-competition-create-key-01',
    'LEAGUE', 1, 2026, v_rules, v_now
  );
  IF v_result->>'replayed' <> 'false' THEN
    RAISE EXCEPTION 'new competition was incorrectly marked replayed';
  END IF;
  v_competition_id := v_result->'competition'->>'id';
  IF v_result->'competition'->>'createdByClubId' <> v_club
    OR v_result->'competition'->>'name' <> 'CI Test League'
    OR v_result->'competition'->>'status' <> 'REGISTRATION'
    OR v_result->'competition'->>'format' <> 'LEAGUE' THEN
    RAISE EXCEPTION 'created competition fields do not match the requested values';
  END IF;
  IF v_result->'competition'->>'createdAt' NOT LIKE '2026-11-19T12:34:56.789%' THEN
    RAISE EXCEPTION 'competition timestamp did not preserve the UTC instant: %', v_result->'competition'->>'createdAt';
  END IF;
  SELECT count(*) INTO v_entry_count FROM public."CompetitionEntry"
  WHERE "competitionId" = v_competition_id AND "clubId" = v_club;
  IF v_entry_count <> 1 THEN RAISE EXCEPTION 'creator entry was not inserted atomically'; END IF;

  v_result := public.create_competition_http(
    v_user, 'CI Test League', 8, 'ci-competition-create-key-01',
    'LEAGUE', 1, 2026, v_rules, v_now
  );
  IF v_result->>'replayed' <> 'true' OR v_result->'competition'->>'id' <> v_competition_id THEN
    RAISE EXCEPTION 'competition idempotent replay did not return the original row';
  END IF;

  BEGIN
    PERFORM public.create_competition_http(
      v_other_user, 'Different League', 8, 'ci-competition-create-key-01',
      'LEAGUE', 1, 2026, v_rules, v_now
    );
    RAISE EXCEPTION 'expected IDEMPOTENCY_CONFLICT for another owner';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'IDEMPOTENCY_CONFLICT' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.create_competition_http(
      v_user, 'Invalid League', 3, 'ci-competition-create-key-02',
      'LEAGUE', 1, 2026, v_rules, v_now
    );
    RAISE EXCEPTION 'expected INVALID_LEAGUE_SIZE';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'INVALID_LEAGUE_SIZE' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.create_competition_http(
      v_user, 'No Club User', 8, 'ci-competition-create-key-03',
      'LEAGUE', 1, 2026, v_rules, v_now
    );
    RAISE EXCEPTION 'expected success only for users with clubs';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'CLUB_NOT_FOUND' THEN RAISE; END IF;
  END;
END;
$test$;

ROLLBACK;
