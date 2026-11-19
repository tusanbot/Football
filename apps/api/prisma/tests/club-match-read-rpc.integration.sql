BEGIN;
SET LOCAL TIME ZONE 'Pacific/Honolulu';
DO $test$
DECLARE
  v_user text := 'ci-club-match-user';
  v_other_user text := 'ci-club-match-other-user';
  v_club text := 'ci-club-match-club';
  v_opponent text := 'ci-club-match-opponent';
  v_competition text := 'ci-club-match-competition';
  v_match text := 'ci-club-match-fixture';
  v_result jsonb; v_message text;
BEGIN
  INSERT INTO public."User" (id, "telegramId", "updatedAt")
  VALUES (v_user, 'ci-club-match-tg', now() AT TIME ZONE 'UTC'),
         (v_other_user, 'ci-club-match-other-tg', now() AT TIME ZONE 'UTC') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public."Club" (id, "ownerId", name, slug, "updatedAt")
  VALUES (v_club, v_user, 'CI Match Club', 'ci-club-match-club', now() AT TIME ZONE 'UTC'),
         (v_opponent, v_other_user, 'CI Match Opponent', 'ci-club-match-opponent', now() AT TIME ZONE 'UTC') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public."Player" (id, "clubId", "firstName", "lastName", nationality, age, position, overall, potential, attributes, wage, "contractDays", "updatedAt")
  VALUES ('ci-club-match-player', v_club, 'Goal', 'Scorer', 'IR', 25, 'ST'::"PlayerPosition", 70, 75, '{}'::jsonb, 10, 365, now() AT TIME ZONE 'UTC') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public."Competition" (id, "idempotencyKey", name, season, format, status, "createdByClubId", "updatedAt")
  VALUES (v_competition, 'ci-club-match-competition-key', 'CI Match League', 2026, 'LEAGUE', 'ACTIVE', v_club, now() AT TIME ZONE 'UTC') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public."CompetitionEntry" (id, "competitionId", "clubId")
  VALUES ('ci-club-match-entry', v_competition, v_club) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public."FootballMatch" (id, "idempotencyKey", type, status, "homeClubId", "awayClubId", "competitionId", "scheduledAt", seed, "homeScore", "awayScore", attendance, "ticketRevenue")
  VALUES (v_match, 'ci-club-match-idempotency', 'LEAGUE', 'IN_PROGRESS', v_club, v_opponent, v_competition,
    '2026-11-19T12:00:00Z', 'ci-club-match-seed', 1, 0, 1200, 4500) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public."MatchRuntime" (id, "matchId", status, "currentMinute", "nextActionAt", "simulationState", "kickoffSnapshot")
  VALUES ('ci-club-match-runtime', v_match, 'RUNNING', 45, '2026-11-19T12:45:00Z',
    '{"segment":{"home":{"side":{"formation":"4-3-3","tactics":{},"players":[]}}},"substitutions":{"home":{"substitutionsUsed":2}}}'::jsonb,
    '{"home":{"formation":"4-3-3","tactics":{},"players":[]}}'::jsonb) ON CONFLICT ("matchId") DO NOTHING;
  INSERT INTO public."MatchTacticalCheckpoint" (id, "matchId", "checkpointKey", kind, minute, status, "openedAt", "decisionDeadlineAt", "nextSegmentAt")
  VALUES ('ci-club-match-checkpoint', v_match, 'half-time', 'HALF_TIME', 45, 'OPEN',
    '2026-11-19T12:45:00Z', '2026-11-19T12:45:05Z', '2026-11-19T12:45:05Z') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public."MatchTacticalDecision" (id, "idempotencyKey", "checkpointId", "clubId", "submittedByUserId", instruction, "submittedAt")
  VALUES ('ci-club-match-decision', 'ci-club-match-decision-key', 'ci-club-match-checkpoint',
    v_club, v_user, '{"mentality":"BALANCED"}'::jsonb, '2026-11-19T12:45:01Z') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public."MatchEvent" (id, "matchId", sequence, minute, type, "teamId", "playerId", detail)
  VALUES ('ci-club-match-event', v_match, 1, 12, 'GOAL', v_club, 'ci-club-match-player', 'Goal scored') ON CONFLICT (id) DO NOTHING;

  v_result := public.list_club_matches_http(v_user);
  IF v_result->>'clubId' <> v_club OR jsonb_array_length(v_result->'matches') <> 1
    OR jsonb_array_length(v_result->'competitions') <> 1 THEN RAISE EXCEPTION 'club match list envelope mismatch: %', v_result; END IF;
  IF v_result#>>'{matches,0,runtime,status}' <> 'RUNNING'
    OR (v_result#>>'{matches,0,runtime,currentMinute}')::integer <> 45
    OR jsonb_array_length(v_result#>'{matches,0,checkpoints}') <> 1
    OR v_result#>>'{matches,0,events,0,playerName}' <> 'Goal Scorer'
    OR v_result#>>'{matches,0,ticketRevenue}' <> '4500' THEN RAISE EXCEPTION 'club match detail payload mismatch: %', v_result; END IF;
  IF v_result#>>'{matches,0,checkpoints,0,decisions,0,clubId}' <> v_club THEN RAISE EXCEPTION 'checkpoint decision missing: %', v_result; END IF;
  BEGIN
    PERFORM public.list_club_matches_http('ci-club-match-missing-user');
    RAISE EXCEPTION 'expected CLUB_NOT_FOUND';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'CLUB_NOT_FOUND' THEN RAISE; END IF;
  END;
END;
$test$;
ROLLBACK;
