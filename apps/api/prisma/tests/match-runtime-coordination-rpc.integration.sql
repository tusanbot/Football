-- Match runtime coordination RPC contract, lease ownership, checkpoint atomicity and grants.
BEGIN;
DO $test$
DECLARE
  v_now timestamp without time zone := now()::timestamp without time zone;
  v_user_home text := 'ci-runtime-coord-home-user';
  v_user_away text := 'ci-runtime-coord-away-user';
  v_club_home text := 'ci-runtime-coord-home-club';
  v_club_away text := 'ci-runtime-coord-away-club';
  v_match text := 'ci-runtime-coord-match';
  v_runtime text;
  v_schedule record;
  v_fixture record;
  v_claim record;
  v_claim_again bigint;
  v_checkpoint jsonb;
  v_decision jsonb;
  v_replay jsonb;
  v_resolved boolean;
  v_released boolean;
BEGIN
  INSERT INTO public."User"(id,"telegramId","updatedAt") VALUES
    (v_user_home,'ci-runtime-coord-home-tg',now()),
    (v_user_away,'ci-runtime-coord-away-tg',now())
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt") VALUES
    (v_club_home,v_user_home,'Runtime Coordination Home','ci-runtime-coord-home',now()),
    (v_club_away,v_user_away,'Runtime Coordination Away','ci-runtime-coord-away',now())
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,attributes,wage,"contractDays","lineupSlot","updatedAt")
  SELECT 'ci-runtime-coord-home-player-'||n,v_club_home,'Home',n::text,'IR',25,
    CASE WHEN n=1 THEN 'GK'::public."PlayerPosition" ELSE 'CB'::public."PlayerPosition" END,60,65,'{}'::jsonb,10,365,n,now()
  FROM generate_series(1,11) n ON CONFLICT(id) DO NOTHING;
  INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,attributes,wage,"contractDays","lineupSlot","updatedAt")
  SELECT 'ci-runtime-coord-away-player-'||n,v_club_away,'Away',n::text,'IR',25,
    CASE WHEN n=1 THEN 'GK'::public."PlayerPosition" ELSE 'CB'::public."PlayerPosition" END,60,65,'{}'::jsonb,10,365,n,now()
  FROM generate_series(1,11) n ON CONFLICT(id) DO NOTHING;
  INSERT INTO public."FootballMatch"(id,"idempotencyKey",type,status,"homeClubId","awayClubId","scheduledAt",seed,"updatedAt")
  VALUES(v_match,'ci-runtime-coord-match-key','FRIENDLY','SCHEDULED',v_club_home,v_club_away,v_now-interval '1 minute','ci-runtime-coord-seed',now())
  ON CONFLICT(id) DO NOTHING;

  SELECT * INTO v_fixture FROM public.get_due_match_runtime_fixtures(v_now,10) WHERE match_id=v_match;
  IF NOT FOUND OR v_fixture.home_club->>'ownerId'<>v_user_home
    OR jsonb_array_length(v_fixture.home_club->'players')<>11
    OR v_fixture.away_club->>'ownerId'<>v_user_away THEN
    RAISE EXCEPTION 'due fixture RPC did not return complete club snapshots';
  END IF;
  IF public.enqueue_match_runtime_snapshots(jsonb_build_array(jsonb_build_object(
    'match_id',v_match,'scheduled_at',v_fixture.scheduled_at,
    'kickoff_snapshot',jsonb_build_object('home',jsonb_build_object('ticketPrice','50'),'away',jsonb_build_object('ticketPrice','50')),
    'fallback_plan',jsonb_build_object('home',NULL,'away',NULL)
  )))<>1 THEN RAISE EXCEPTION 'runtime enqueue did not insert exactly one runtime'; END IF;
  SELECT "id" INTO v_runtime FROM public."MatchRuntime" WHERE "matchId"=v_match;
  IF v_runtime IS NULL THEN RAISE EXCEPTION 'runtime enqueue did not persist runtime'; END IF;

  SELECT * INTO v_schedule FROM public.get_match_coordinator_schedule();
  IF NOT v_schedule.has_due_runtime THEN RAISE EXCEPTION 'coordinator schedule did not flag due runtime'; END IF;
  SELECT * INTO v_claim FROM public.claim_due_match_runtimes('ci-runtime-coord-worker',v_now,60000,10);
  IF v_claim.runtime_id<>v_runtime OR v_claim.lease_token IS NULL OR v_claim.lease_expires_at<=v_now THEN
    RAISE EXCEPTION 'runtime lease claim returned invalid lease: %',row_to_json(v_claim);
  END IF;
  SELECT count(*) INTO v_claim_again FROM public.claim_due_match_runtimes('ci-runtime-coord-worker-2',v_now,60000,10);
  IF v_claim_again<>0 THEN RAISE EXCEPTION 'active lease was claimed twice'; END IF;

  IF NOT public.advance_match_runtime_first_half(
    v_runtime,1,v_claim.lease_token,
    '{"segment":{"currentMinute":45},"substitutions":{"home":{},"away":{}}}'::jsonb,
    v_now,v_now+interval '45 seconds',v_now+interval '50 seconds',
    jsonb_build_array(jsonb_build_object('event_key','coord-kickoff','kind','KICKOFF','minute',0,
      'home_score',0,'away_score',0,'payload','{}'::jsonb,'available_at',v_now))
  ) THEN RAISE EXCEPTION 'first-half runtime advance was rejected'; END IF;

  v_checkpoint:=public.get_match_runtime_open_checkpoint(v_match);
  IF v_checkpoint->'checkpoint'->>'kind'<>'HALF_TIME' OR jsonb_array_length(v_checkpoint->'decisions')<>0 THEN
    RAISE EXCEPTION 'open checkpoint read returned unexpected payload: %',v_checkpoint;
  END IF;
  v_decision:=public.submit_match_runtime_tactical_decision(
    v_user_home,v_match,'minute-45','ci-runtime-coord-decision-key',
    '{"mentality":"ATTACKING"}'::jsonb,v_now+interval '46 seconds'
  );
  IF v_decision->>'replayed'<>'false' OR v_decision->'decision'->>'clubId'<>v_club_home THEN
    RAISE EXCEPTION 'tactical decision was not recorded: %',v_decision;
  END IF;
  v_replay:=public.submit_match_runtime_tactical_decision(
    v_user_home,v_match,'minute-45','ci-runtime-coord-decision-key',
    '{"mentality":"ATTACKING"}'::jsonb,v_now+interval '46 seconds'
  );
  IF v_replay->>'replayed'<>'true' OR v_replay->'decision'->>'id'<>v_decision->'decision'->>'id' THEN
    RAISE EXCEPTION 'tactical decision replay was not idempotent: %',v_replay;
  END IF;

  v_resolved:=public.resolve_match_runtime_checkpoint(
    v_runtime,v_checkpoint->'checkpoint'->>'id',2,v_claim.lease_token,
    '{"home":{"source":"USER"},"away":{"source":"AI"}}'::jsonb,60,
    '{"segment":{"currentMinute":60},"substitutions":{"home":{},"away":{}}}'::jsonb,
    v_now+interval '60 seconds','[]'::jsonb,
    jsonb_build_object('checkpoint_key','minute-60','kind','MINUTE_60','minute',60,
      'opened_at',v_now+interval '60 seconds','decision_deadline_at',v_now+interval '65 seconds',
      'next_segment_at',v_now+interval '65 seconds')
  );
  IF NOT v_resolved THEN RAISE EXCEPTION 'checkpoint resolution was rejected'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public."MatchRuntime" WHERE id=v_runtime AND "currentMinute"=60 AND "stateVersion"=3)
    OR NOT EXISTS(SELECT 1 FROM public."MatchTacticalCheckpoint" WHERE "matchId"=v_match AND "checkpointKey"='minute-45' AND status='RESOLVED')
    OR NOT EXISTS(SELECT 1 FROM public."MatchTacticalCheckpoint" WHERE "matchId"=v_match AND "checkpointKey"='minute-60' AND status='OPEN') THEN
    RAISE EXCEPTION 'checkpoint resolution did not atomically advance runtime and checkpoint rows';
  END IF;

  SELECT released INTO v_released FROM public.release_match_runtime_lease(v_runtime,'wrong-token',v_now+interval '5 minutes',NULL);
  IF v_released THEN RAISE EXCEPTION 'lease release accepted a mismatched token'; END IF;
  SELECT released INTO v_released FROM public.release_match_runtime_lease(v_runtime,v_claim.lease_token,v_now+interval '5 minutes',NULL);
  IF NOT v_released THEN RAISE EXCEPTION 'lease release rejected the current token'; END IF;

  IF has_function_privilege('anon','public.claim_due_match_runtimes(text,timestamp without time zone,integer,integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.claim_due_match_runtimes(text,timestamp without time zone,integer,integer)','EXECUTE')
    OR has_function_privilege('anon','public.resolve_match_runtime_checkpoint(text,text,integer,text,jsonb,integer,jsonb,timestamp without time zone,jsonb,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.resolve_match_runtime_checkpoint(text,text,integer,text,jsonb,integer,jsonb,timestamp without time zone,jsonb,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'untrusted roles must not execute worker coordination RPCs';
  END IF;
  IF NOT has_function_privilege('service_role','public.claim_due_match_runtimes(text,timestamp without time zone,integer,integer)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.resolve_match_runtime_checkpoint(text,text,integer,text,jsonb,integer,jsonb,timestamp without time zone,jsonb,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute worker coordination RPCs';
  END IF;
END;
$test$;
ROLLBACK;
