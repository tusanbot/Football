-- Verify settlement + competition advancement is exposed only through
-- service-role RPC wrappers and that both operations share one SQL function body.
BEGIN;
DO $test$
DECLARE
 v_match_oid regprocedure;
 v_forfeit_oid regprocedure;
 v_advance_oid regprocedure;
 v_pyramid_oid regprocedure;
 v_event_oid regprocedure;
 v_settle_oid regprocedure;
 v_forfeit_base_oid regprocedure;
 v_match_def text;
 v_forfeit_def text;
BEGIN
 v_match_oid:=to_regprocedure(
  'public.settle_and_advance_match_runtime_http(text,text,text,timestamp with time zone,jsonb,integer,integer,integer,integer,bigint,bigint)'
 );
 IF v_match_oid IS NULL THEN RAISE EXCEPTION 'atomic match settlement RPC is missing'; END IF;
 v_match_def:=pg_get_functiondef(v_match_oid);
 IF position('settle_match_runtime_result' IN v_match_def)=0
  OR position('advance_competition_after_match_http' IN v_match_def)=0
  OR position('finalize_pyramid_league_http' IN v_match_def)=0
  OR position('finalize_event_tournament_http' IN v_match_def)=0
  OR position('jsonb_build_object(''advancement''' IN v_match_def)=0 THEN
  RAISE EXCEPTION 'match settlement RPC does not compose settlement and advancement atomically';
 END IF;
 IF NOT has_function_privilege('service_role',v_match_oid,'EXECUTE')
  OR has_function_privilege('anon',v_match_oid,'EXECUTE')
  OR has_function_privilege('authenticated',v_match_oid,'EXECUTE') THEN
  RAISE EXCEPTION 'atomic match settlement RPC grants are invalid';
 END IF;

 v_forfeit_oid:=to_regprocedure(
  'public.settle_invalid_match_fixture_and_advance_http(text,timestamp with time zone)'
 );
 IF v_forfeit_oid IS NULL THEN RAISE EXCEPTION 'atomic invalid-match forfeit RPC is missing'; END IF;
 v_forfeit_def:=pg_get_functiondef(v_forfeit_oid);
 IF position('settle_invalid_match_fixture_http' IN v_forfeit_def)=0
  OR position('advance_competition_after_match_http' IN v_forfeit_def)=0
  OR position('finalize_pyramid_league_http' IN v_forfeit_def)=0
  OR position('finalize_event_tournament_http' IN v_forfeit_def)=0
  OR position('jsonb_build_object(''advancement''' IN v_forfeit_def)=0 THEN
  RAISE EXCEPTION 'invalid-match forfeit RPC does not compose settlement and advancement atomically';
 END IF;
 IF NOT has_function_privilege('service_role',v_forfeit_oid,'EXECUTE')
  OR has_function_privilege('anon',v_forfeit_oid,'EXECUTE')
  OR has_function_privilege('authenticated',v_forfeit_oid,'EXECUTE') THEN
  RAISE EXCEPTION 'atomic invalid-match forfeit RPC grants are invalid';
 END IF;

 v_advance_oid:=to_regprocedure('public.advance_competition_after_match_http(text,integer,timestamp with time zone)');
 v_pyramid_oid:=to_regprocedure('public.finalize_pyramid_league_http(text,timestamp with time zone)');
 v_event_oid:=to_regprocedure('public.finalize_event_tournament_http(text,timestamp with time zone)');
 v_settle_oid:=to_regprocedure('public.settle_match_runtime_result(text,text,text,timestamp without time zone,jsonb,integer,integer,integer,integer,bigint,bigint)');
 v_forfeit_base_oid:=to_regprocedure('public.settle_invalid_match_fixture_http(text,timestamp without time zone)');
 IF v_advance_oid IS NULL OR v_pyramid_oid IS NULL OR v_event_oid IS NULL
  OR v_settle_oid IS NULL OR v_forfeit_base_oid IS NULL THEN
  RAISE EXCEPTION 'one or more atomic wrapper dependencies are missing';
 END IF;
 IF NOT has_function_privilege('service_role',v_advance_oid,'EXECUTE')
  OR NOT has_function_privilege('service_role',v_pyramid_oid,'EXECUTE')
  OR NOT has_function_privilege('service_role',v_event_oid,'EXECUTE')
  OR NOT has_function_privilege('service_role',v_settle_oid,'EXECUTE')
  OR NOT has_function_privilege('service_role',v_forfeit_base_oid,'EXECUTE')
  OR has_function_privilege('anon',v_advance_oid,'EXECUTE')
  OR has_function_privilege('authenticated',v_advance_oid,'EXECUTE')
  OR has_function_privilege('anon',v_pyramid_oid,'EXECUTE')
  OR has_function_privilege('authenticated',v_pyramid_oid,'EXECUTE')
  OR has_function_privilege('anon',v_event_oid,'EXECUTE')
  OR has_function_privilege('authenticated',v_event_oid,'EXECUTE') THEN
  RAISE EXCEPTION 'atomic wrapper dependency grants are invalid';
 END IF;
END;
$test$;

-- Exercise the actual wrapper transaction boundary with controlled dependency
-- failures. The settlement stub writes a marker; advancement then raises.
-- The wrapper must roll the marker back together with settlement work.
CREATE TEMP TABLE atomic_settlement_effects(id integer PRIMARY KEY) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION public.settle_match_runtime_result(
 p_match_id text,p_runtime_id text,p_lease_token text,p_now timestamp without time zone,
 p_result jsonb,p_injury_duration_days integer,p_red_card_suspension_matches integer,
 p_yellow_cards_to_suspend integer,p_yellow_card_suspension_matches integer,
 p_home_reward bigint,p_away_reward bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $stub$
BEGIN
 INSERT INTO pg_temp.atomic_settlement_effects(id) VALUES(1);
 RETURN jsonb_build_object('matchId',p_match_id,'competitionId','atomic-test-competition','round',1);
END;
$stub$;

CREATE OR REPLACE FUNCTION public.advance_competition_after_match_http(
 p_competition_id text,p_round integer,p_now timestamptz
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $stub$
BEGIN
 INSERT INTO pg_temp.atomic_settlement_effects(id) VALUES(2);
 RETURN jsonb_build_object('completed',true);
END;
$stub$;

CREATE OR REPLACE FUNCTION public.finalize_pyramid_league_http(
 p_competition_id text,p_now timestamptz
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $stub$
BEGIN
 INSERT INTO pg_temp.atomic_settlement_effects(id) VALUES(3);
 RETURN jsonb_build_object('processed',true);
END;
$stub$;

CREATE OR REPLACE FUNCTION public.finalize_event_tournament_http(
 p_competition_id text,p_now timestamptz
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $stub$
BEGIN
 RAISE EXCEPTION USING MESSAGE='ATOMIC_TEST_EVENT_FINALIZATION_FAILURE',ERRCODE='P0001';
END;
$stub$;

DO $atomic_test$
DECLARE
 v_failed boolean:=false;
 v_effects integer;
BEGIN
 BEGIN
  PERFORM public.settle_and_advance_match_runtime_http(
   'atomic-test-match','atomic-test-runtime','atomic-test-lease',now(),'{}'::jsonb,
   0,0,0,0,0,0
  );
 EXCEPTION WHEN OTHERS THEN
  v_failed:=true;
 END;
 IF NOT v_failed THEN
  RAISE EXCEPTION 'atomic settlement wrapper unexpectedly succeeded';
 END IF;
 SELECT count(*) INTO v_effects FROM pg_temp.atomic_settlement_effects;
 IF v_effects<>0 THEN
  RAISE EXCEPTION 'settlement/advancement/finalization effects survived event finalization failure: %',v_effects;
 END IF;
END;
$atomic_test$;
ROLLBACK;
