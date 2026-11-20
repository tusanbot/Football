-- Scheduled finalization workers isolate failures per candidate and expose counts.
BEGIN;
DO $test$
DECLARE
 v_pyramid_oid regprocedure;
 v_event_oid regprocedure;
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
END;
$test$;
ROLLBACK;
