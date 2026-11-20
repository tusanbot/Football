-- Scheduled finalization workers isolate failures per candidate and expose counts.
BEGIN;
DO $test$
DECLARE
 v_pyramid_oid regprocedure;
 v_event_oid regprocedure;
 v_tier_name_oid regprocedure;
 v_tier_bps_oid regprocedure;
 v_adjust_oid regprocedure;
 v_assign_oid regprocedure;
 v_pyramid_def text;
 v_event_def text;
BEGIN
 v_pyramid_oid:=to_regprocedure('public.process_due_pyramid_work_http(timestamp with time zone,integer)');
 v_event_oid:=to_regprocedure('public.process_due_event_tournament_finalizations_http(timestamp with time zone,integer)');
 IF v_pyramid_oid IS NULL OR v_event_oid IS NULL THEN
  RAISE EXCEPTION 'durable tournament retry RPCs are missing';
 END IF;
 v_pyramid_def:=pg_get_functiondef(v_pyramid_oid);
 v_event_def:=pg_get_functiondef(v_event_oid);
 IF position('WHEN OTHERS' IN v_pyramid_def)=0 OR position('failed' IN v_pyramid_def)=0
  OR position('RAISE WARNING' IN v_pyramid_def)=0 THEN
  RAISE EXCEPTION 'pyramid work queue does not isolate failed candidates';
 END IF;
 IF position('WHEN OTHERS' IN v_event_def)=0 OR position('failed' IN v_event_def)=0
  OR position('RAISE WARNING' IN v_event_def)=0 THEN
  RAISE EXCEPTION 'event tournament work queue does not isolate failed candidates';
 END IF;
 IF NOT has_function_privilege('service_role',v_pyramid_oid,'EXECUTE')
  OR NOT has_function_privilege('service_role',v_event_oid,'EXECUTE')
  OR has_function_privilege('anon',v_pyramid_oid,'EXECUTE')
  OR has_function_privilege('authenticated',v_pyramid_oid,'EXECUTE')
  OR has_function_privilege('anon',v_event_oid,'EXECUTE')
  OR has_function_privilege('authenticated',v_event_oid,'EXECUTE') THEN
  RAISE EXCEPTION 'durable tournament retry RPC grants are invalid';
 END IF;

 v_tier_name_oid:=to_regprocedure('public.pyramid_tier_name_http(integer)');
 v_tier_bps_oid:=to_regprocedure('public.pyramid_tier_bps_http(integer)');
 v_adjust_oid:=to_regprocedure('public.adjust_pyramid_club_values_http(text,integer,integer)');
 v_assign_oid:=to_regprocedure('public.assign_pyramid_queue_http(integer,integer,timestamp with time zone)');
 IF v_tier_name_oid IS NULL OR v_tier_bps_oid IS NULL OR v_adjust_oid IS NULL OR v_assign_oid IS NULL
  OR NOT has_function_privilege('service_role',v_tier_name_oid,'EXECUTE')
  OR NOT has_function_privilege('service_role',v_tier_bps_oid,'EXECUTE')
  OR NOT has_function_privilege('service_role',v_adjust_oid,'EXECUTE')
  OR NOT has_function_privilege('service_role',v_assign_oid,'EXECUTE')
  OR has_function_privilege('anon',v_tier_name_oid,'EXECUTE')
  OR has_function_privilege('authenticated',v_tier_name_oid,'EXECUTE')
  OR has_function_privilege('anon',v_tier_bps_oid,'EXECUTE')
  OR has_function_privilege('authenticated',v_tier_bps_oid,'EXECUTE')
  OR has_function_privilege('anon',v_adjust_oid,'EXECUTE')
  OR has_function_privilege('authenticated',v_adjust_oid,'EXECUTE')
  OR has_function_privilege('anon',v_assign_oid,'EXECUTE')
  OR has_function_privilege('authenticated',v_assign_oid,'EXECUTE') THEN
  RAISE EXCEPTION 'pyramid internal helper RPC grants are invalid';
 END IF;
END;
$test$;

-- Exercise the real queue loops with deterministic per-item failures. The
-- first candidate fails inside its isolated subtransaction; the second must
-- still commit its marker and be counted as completed/finalized.
DO $retry_isolation$
DECLARE
 v_now timestamptz := '2026-11-20T12:00:00Z'::timestamptz;
 v_pyramid jsonb;
 v_event jsonb;
BEGIN
 CREATE TEMP TABLE retry_isolation_effects (
  queue_name text NOT NULL,
  competition_id text NOT NULL,
  PRIMARY KEY(queue_name,competition_id)
 ) ON COMMIT DROP;

 INSERT INTO public."User"(id,"telegramId","updatedAt")
 VALUES
 ('ci-retry-user-1','ci-retry-tg-1',v_now AT TIME ZONE 'UTC'),
 ('ci-retry-user-2','ci-retry-tg-2',v_now AT TIME ZONE 'UTC'),
 ('ci-retry-user-3','ci-retry-tg-3',v_now AT TIME ZONE 'UTC'),
 ('ci-retry-user-4','ci-retry-tg-4',v_now AT TIME ZONE 'UTC')
 ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt")
 VALUES
 ('ci-retry-club-1','ci-retry-user-1','CI Retry Club 1','ci-retry-club-1',v_now AT TIME ZONE 'UTC'),
 ('ci-retry-club-2','ci-retry-user-2','CI Retry Club 2','ci-retry-club-2',v_now AT TIME ZONE 'UTC'),
 ('ci-retry-club-3','ci-retry-user-3','CI Retry Club 3','ci-retry-club-3',v_now AT TIME ZONE 'UTC'),
 ('ci-retry-club-4','ci-retry-user-4','CI Retry Club 4','ci-retry-club-4',v_now AT TIME ZONE 'UTC')
 ON CONFLICT(id) DO NOTHING;

 INSERT INTO public."Competition"(
  id,"idempotencyKey",name,season,format,status,"maxTeams","cupLegs","createdByClubId",rules,"completedAt","updatedAt"
 ) VALUES
 ('ci-retry-pyramid-fail','ci-retry-pyr-key-1','CI Retry Pyramid Fail',2026,'LEAGUE','COMPLETED',4,1,'ci-retry-club-1','{}'::jsonb,v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC'),
 ('ci-retry-pyramid-ok','ci-retry-pyr-key-2','CI Retry Pyramid OK',2026,'LEAGUE','COMPLETED',4,1,'ci-retry-club-2','{}'::jsonb,v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC'),
 ('ci-retry-event-fail','ci-retry-event-key-1','CI Retry Event Fail',2026,'LEAGUE','COMPLETED',4,1,'ci-retry-club-3','{}'::jsonb,v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC'),
 ('ci-retry-event-ok','ci-retry-event-key-2','CI Retry Event OK',2026,'LEAGUE','COMPLETED',4,1,'ci-retry-club-4','{}'::jsonb,v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC')
 ON CONFLICT(id) DO NOTHING;

 INSERT INTO public."PyramidLeague"(id,"competitionId",tier,season,"groupNumber","createdAt")
 VALUES
 ('ci-retry-pyr-1','ci-retry-pyramid-fail',2,2026,1,(v_now-interval '2 minutes') AT TIME ZONE 'UTC'),
 ('ci-retry-pyr-2','ci-retry-pyramid-ok',2,2026,2,(v_now-interval '1 minute') AT TIME ZONE 'UTC')
 ON CONFLICT(id) DO NOTHING;

 INSERT INTO public."EventTournament"(
  id,"idempotencyKey",title,description,status,"maxParticipants","registrationEndsAt",
  "startsAt","createdByTelegramId","competitionId","createdAt","updatedAt"
 ) VALUES
 ('ci-retry-event-1','ci-retry-event-key-1','CI Retry Event Fail','integration test','ACTIVE',4,v_now,v_now,'ci-retry-admin','ci-retry-event-fail',
  (v_now-interval '2 minutes') AT TIME ZONE 'UTC',(v_now-interval '2 minutes') AT TIME ZONE 'UTC'),
 ('ci-retry-event-2','ci-retry-event-key-2','CI Retry Event OK','integration test','ACTIVE',4,v_now,v_now,'ci-retry-admin','ci-retry-event-ok',
  (v_now-interval '1 minute') AT TIME ZONE 'UTC',(v_now-interval '1 minute') AT TIME ZONE 'UTC')
 ON CONFLICT(id) DO NOTHING;

 CREATE OR REPLACE FUNCTION public.finalize_pyramid_league_http(p_competition_id text,p_now timestamptz)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp
 AS $stub$
 BEGIN
  IF p_competition_id='ci-retry-pyramid-fail' THEN
   RAISE EXCEPTION USING MESSAGE='CI_PYRAMID_FINALIZATION_TRANSIENT_FAILURE',ERRCODE='P0001';
  END IF;
  INSERT INTO pg_temp.retry_isolation_effects(queue_name,competition_id)
  VALUES('pyramid',p_competition_id);
  RETURN jsonb_build_object('processed',true);
 END;
 $stub$;

 v_pyramid:=public.process_due_pyramid_work_http(v_now,10);
 IF (v_pyramid->>'failed')::integer<>1 OR (v_pyramid->>'completedLeagues')::integer<>1
  OR (SELECT count(*) FROM pg_temp.retry_isolation_effects WHERE queue_name='pyramid' AND competition_id='ci-retry-pyramid-ok')<>1
  OR EXISTS(SELECT 1 FROM pg_temp.retry_isolation_effects WHERE queue_name='pyramid' AND competition_id='ci-retry-pyramid-fail') THEN
  RAISE EXCEPTION 'pyramid queue did not isolate the failed candidate and continue: %',v_pyramid;
 END IF;

 CREATE OR REPLACE FUNCTION public.finalize_event_tournament_http(p_competition_id text,p_now timestamptz)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp
 AS $stub$
 BEGIN
  IF p_competition_id='ci-retry-event-fail' THEN
   RAISE EXCEPTION USING MESSAGE='CI_EVENT_FINALIZATION_TRANSIENT_FAILURE',ERRCODE='P0001';
  END IF;
  INSERT INTO pg_temp.retry_isolation_effects(queue_name,competition_id)
  VALUES('event',p_competition_id);
  RETURN jsonb_build_object('finalized',true);
 END;
 $stub$;

 v_event:=public.process_due_event_tournament_finalizations_http(v_now,10);
 IF (v_event->>'failed')::integer<>1 OR (v_event->>'candidates')::integer<>2
  OR (v_event->>'finalized')::integer<>1
  OR (SELECT count(*) FROM pg_temp.retry_isolation_effects WHERE queue_name='event' AND competition_id='ci-retry-event-ok')<>1
  OR EXISTS(SELECT 1 FROM pg_temp.retry_isolation_effects WHERE queue_name='event' AND competition_id='ci-retry-event-fail') THEN
  RAISE EXCEPTION 'event tournament queue did not isolate the failed candidate and continue: %',v_event;
 END IF;
END;
$retry_isolation$;

ROLLBACK;
