-- Integration coverage for the group-scoped competition RPCs. Ephemeral CI only.
BEGIN;
SET LOCAL TIME ZONE 'Pacific/Honolulu';
DO $test$
DECLARE
  v_users text[] := ARRAY['ci-group-league-user-1','ci-group-league-user-2','ci-group-league-user-3','ci-group-league-user-4'];
  v_telegrams text[] := ARRAY['991000001101','991000001102','991000001103','991000001104'];
  v_clubs text[] := ARRAY['ci-group-league-club-1','ci-group-league-club-2','ci-group-league-club-3','ci-group-league-club-4'];
  v_group_tg text := '-10019910001101';
  v_now timestamptz := '2026-11-19T12:34:56.789Z'::timestamptz;
  v_result jsonb; v_competition_id text; v_message text; v_count integer;
BEGIN
  INSERT INTO public."User"(id,"telegramId","updatedAt")
  SELECT v_users[i],v_telegrams[i],v_now AT TIME ZONE 'UTC'
  FROM generate_subscripts(v_users,1) i ON CONFLICT(id) DO NOTHING;
  INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt")
  SELECT v_clubs[i],v_users[i],'CI Group League Club '||i,'ci-group-league-'||i,v_now AT TIME ZONE 'UTC'
  FROM generate_subscripts(v_clubs,1) i ON CONFLICT(id) DO NOTHING;
  INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,attributes,wage,"contractDays","lineupSlot","updatedAt")
  SELECT 'ci-group-league-player-'||c||'-'||p,v_clubs[c],'Player',p::text,'IR',25,
    CASE WHEN p=11 THEN 'GK'::"PlayerPosition" ELSE 'CB'::"PlayerPosition" END,
    60,65,'{}'::jsonb,10,365,p,v_now AT TIME ZONE 'UTC'
  FROM generate_subscripts(v_clubs,1) c CROSS JOIN generate_series(1,11) p ON CONFLICT(id) DO NOTHING;

  v_result:=public.register_telegram_group_http(v_telegrams[1],v_group_tg,'CI Group League','OWNER',20,v_now);
  IF v_result->>'role'<>'OWNER' THEN RAISE EXCEPTION 'group owner registration mismatch: %',v_result; END IF;
  INSERT INTO public."GroupMembership"(id,"groupId","userId",role,"joinedAt")
  SELECT 'ci-group-league-membership-'||i,(SELECT id FROM public."TelegramGroup" WHERE "telegramId"=v_group_tg),v_users[i],
    'MEMBER'::"GroupRole",v_now AT TIME ZONE 'UTC'
  FROM generate_series(2,4) i ON CONFLICT("groupId","userId") DO NOTHING;

  v_result:=public.create_group_league_http(v_telegrams[1],v_group_tg,'CI Group League',4,'ci-group-league-create-0001',v_now);
  v_competition_id:=v_result->'competition'->>'id';
  IF v_result->>'replayed'<>'false'
    OR v_result->'competition'->>'groupId'<>(SELECT id FROM public."TelegramGroup" WHERE "telegramId"=v_group_tg)
    OR v_result->'competition'->>'createdByClubId'<>v_clubs[1] THEN
    RAISE EXCEPTION 'group league creation mismatch: %',v_result;
  END IF;
  SELECT count(*) INTO v_count FROM public."CompetitionEntry" WHERE "competitionId"=v_competition_id AND "clubId"=v_clubs[1];
  IF v_count<>1 THEN RAISE EXCEPTION 'creator was not entered exactly once'; END IF;

  v_result:=public.create_group_league_http(v_telegrams[1],v_group_tg,'CI Group League',4,'ci-group-league-create-0001',v_now);
  IF v_result->>'replayed'<>'true' OR v_result->'competition'->>'id'<>v_competition_id THEN RAISE EXCEPTION 'group league idempotent create mismatch: %',v_result; END IF;
  BEGIN
    PERFORM public.create_group_league_http(v_telegrams[2],v_group_tg,'Not Allowed',4,'ci-group-league-create-0002',v_now);
    RAISE EXCEPTION 'expected GROUP_MANAGER_REQUIRED for member create';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT; IF v_message<>'GROUP_MANAGER_REQUIRED' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.create_group_league_http(v_telegrams[1],v_group_tg,'Different Name',4,'ci-group-league-create-0001',v_now);
    RAISE EXCEPTION 'expected IDEMPOTENCY_CONFLICT for changed group league payload';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT; IF v_message<>'IDEMPOTENCY_CONFLICT' THEN RAISE; END IF;
  END;

  v_result:=public.list_group_leagues_http(v_telegrams[1],v_group_tg);
  IF jsonb_array_length(v_result->'leagues')<>1
    OR v_result#>>'{leagues,0,joined}'<>'true'
    OR v_result#>>'{leagues,0,createdByMe}'<>'true'
    OR v_result#>>'{leagues,0,teams}'<>'1' THEN RAISE EXCEPTION 'group league list mismatch: %',v_result; END IF;
  v_result:=public.get_group_league_table_http(v_telegrams[1],v_group_tg,v_competition_id);
  IF v_result#>>'{competition,id}'<>v_competition_id OR jsonb_array_length(v_result#>'{competition,teams}')<>1 THEN
    RAISE EXCEPTION 'group league table mismatch: %',v_result;
  END IF;

  v_result:=public.join_group_league_http(v_telegrams[2],v_group_tg,v_competition_id,v_now+interval '1 second');
  IF v_result->>'joined'<>'true' OR v_result->>'replayed'<>'false' OR v_result->>'autoStarted'<>'false' THEN RAISE EXCEPTION 'group league join mismatch: %',v_result; END IF;
  v_result:=public.join_group_league_http(v_telegrams[2],v_group_tg,v_competition_id,v_now+interval '2 seconds');
  IF v_result->>'replayed'<>'true' OR v_result->>'teams'<>'2' THEN RAISE EXCEPTION 'group league join replay mismatch: %',v_result; END IF;
  PERFORM public.join_group_league_http(v_telegrams[3],v_group_tg,v_competition_id,v_now+interval '3 seconds');
  v_result:=public.join_group_league_http(v_telegrams[4],v_group_tg,v_competition_id,v_now+interval '4 seconds');
  IF v_result->>'autoStarted'<>'true' OR v_result->>'replayed'<>'false'
    OR (v_result->>'fixturesCreated')::integer<>6 OR (v_result->>'rounds')::integer<>3 THEN
    RAISE EXCEPTION 'final group join did not auto-start the league atomically: %',v_result;
  END IF;
  SELECT count(*) INTO v_count FROM public."FootballMatch" WHERE "competitionId"=v_competition_id;
  IF v_count<>6 OR (SELECT status::text FROM public."Competition" WHERE id=v_competition_id)<>'ACTIVE' THEN
    RAISE EXCEPTION 'group league fixtures/status mismatch';
  END IF;
  v_result:=public.join_group_league_http(v_telegrams[4],v_group_tg,v_competition_id,v_now+interval '5 seconds');
  IF v_result->>'replayed'<>'true' OR v_result->>'autoStarted'<>'true' THEN RAISE EXCEPTION 'final group join replay mismatch: %',v_result; END IF;
  v_result:=public.start_group_league_http(v_telegrams[1],v_group_tg,v_competition_id,v_now+interval '6 seconds');
  IF v_result->>'replayed'<>'true' OR v_result->>'teams'<>'4' THEN RAISE EXCEPTION 'group league start replay mismatch: %',v_result; END IF;
  v_result:=public.get_group_league_table_http(v_telegrams[1],v_group_tg,v_competition_id);
  IF jsonb_array_length(v_result#>'{competition,teams}')<>4 THEN RAISE EXCEPTION 'group league standings did not include all clubs: %',v_result; END IF;

  BEGIN
    PERFORM public.join_group_league_http('991000001199',v_group_tg,v_competition_id,v_now);
    RAISE EXCEPTION 'expected ACCOUNT_NOT_FOUND';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT; IF v_message<>'ACCOUNT_NOT_FOUND' THEN RAISE; END IF;
  END;
  UPDATE public."TelegramGroup" SET "isSuspended"=true WHERE "telegramId"=v_group_tg;
  BEGIN
    PERFORM public.list_group_leagues_http(v_telegrams[1],v_group_tg);
    RAISE EXCEPTION 'expected GROUP_SUSPENDED';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT; IF v_message<>'GROUP_SUSPENDED' THEN RAISE; END IF;
  END;
END;
$test$;
ROLLBACK;
