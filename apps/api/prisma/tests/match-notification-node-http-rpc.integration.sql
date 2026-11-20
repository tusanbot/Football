BEGIN;
DO $test$
DECLARE
 v_lifecycle regprocedure:=to_regprocedure('public.claim_due_match_lifecycle_notifications_node_http(integer,integer)');
 v_result regprocedure:=to_regprocedure('public.claim_due_match_result_notifications_node_http(integer,integer)');
 v_checkpoint regprocedure:=to_regprocedure('public.claim_due_match_checkpoint_notifications_node_http(integer,text)');
 v_ack regprocedure:=to_regprocedure('public.ack_match_checkpoint_notification_node_http(text,text,text,boolean,text)');
 v_lifecycle_def text;v_result_def text;v_checkpoint_def text;
BEGIN
 IF v_lifecycle IS NULL OR v_result IS NULL OR v_checkpoint IS NULL OR v_ack IS NULL THEN
  RAISE EXCEPTION 'Node match notification RPC set is incomplete';
 END IF;
 v_lifecycle_def:=pg_get_functiondef(v_lifecycle);v_result_def:=pg_get_functiondef(v_result);v_checkpoint_def:=pg_get_functiondef(v_checkpoint);
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='MatchLifecycleNotification' AND column_name='completedClaimToken')
  OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='MatchResultNotification' AND column_name='completedClaimToken')
  OR position('completedClaimToken' IN pg_get_functiondef(to_regprocedure('public.complete_match_notification_delivery(text,text,text,boolean,text,integer)')))=0 THEN
  RAISE EXCEPTION 'match notification acknowledgement replay support is missing';
 END IF;
 IF position('FOR UPDATE' IN v_lifecycle_def)=0 OR position('SKIP LOCKED' IN v_lifecycle_def)=0
  OR position('claimToken' IN v_lifecycle_def)=0 THEN RAISE EXCEPTION 'lifecycle notification claim is not concurrency-safe';END IF;
 IF position('FOR UPDATE' IN v_result_def)=0 OR position('SKIP LOCKED' IN v_result_def)=0
  OR position('PlayerMatchPerformance' IN v_result_def)=0 THEN RAISE EXCEPTION 'result notification claim is missing locking or scorer data';END IF;
 IF position('FOR UPDATE' IN v_checkpoint_def)=0 OR position('SKIP LOCKED' IN v_checkpoint_def)=0
  OR position('homeBotNotificationAttempts' IN v_checkpoint_def)=0
  OR position('awayBotNotificationAttempts' IN v_checkpoint_def)=0
  OR position('claimToken' IN v_checkpoint_def)=0 OR position('DEAD_LETTER' IN v_checkpoint_def)=0 THEN
  RAISE EXCEPTION 'checkpoint notification claim is missing fencing or dead-letter handling';END IF;
 IF position('DEAD_LETTER' IN v_lifecycle_def)=0 OR position('DEAD_LETTER' IN v_result_def)=0
  OR position('attempts' IN v_lifecycle_def)=0 OR position('attempts' IN v_result_def)=0 THEN
  RAISE EXCEPTION 'match notification queues are missing bounded retries';END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='MatchTacticalCheckpoint' AND column_name='homeBotNotificationClaimToken')
  OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='MatchTacticalCheckpoint' AND column_name='awayBotNotificationClaimToken')
  OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='MatchLifecycleNotification' AND column_name='deadLetteredAt')
  OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='MatchResultNotification' AND column_name='deadLetteredAt') THEN
  RAISE EXCEPTION 'notification fencing/dead-letter columns are missing';END IF;
 IF NOT has_function_privilege('service_role',v_lifecycle,'EXECUTE')
  OR NOT has_function_privilege('service_role',v_result,'EXECUTE')
  OR NOT has_function_privilege('service_role',v_checkpoint,'EXECUTE')
  OR NOT has_function_privilege('service_role',v_ack,'EXECUTE')
  OR has_function_privilege('anon',v_lifecycle,'EXECUTE')
  OR has_function_privilege('authenticated',v_result,'EXECUTE')
  OR has_function_privilege('anon',v_checkpoint,'EXECUTE')
  OR has_function_privilege('authenticated',v_ack,'EXECUTE')
  OR to_regprocedure('public.ack_match_checkpoint_notification_node_http(text,text,boolean,text)') IS NOT NULL THEN
  RAISE EXCEPTION 'Node match notification RPC grants are invalid';
 END IF;
END;
$test$;
ROLLBACK;
