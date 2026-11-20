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
ROLLBACK;
