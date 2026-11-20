BEGIN;
DO $test$
DECLARE
 v_claim regprocedure:=to_regprocedure('public.claim_due_admin_group_broadcasts_http(integer,integer)');
 v_complete regprocedure:=to_regprocedure('public.complete_admin_group_broadcast_delivery_http(text,text)');
 v_fail regprocedure:=to_regprocedure('public.fail_admin_group_broadcast_delivery_http(text,text,text)');
 v_claim_def text;v_fail_def text;
BEGIN
 IF v_claim IS NULL OR v_complete IS NULL OR v_fail IS NULL THEN RAISE EXCEPTION 'admin group broadcast RPC set is incomplete';END IF;
 v_claim_def:=pg_get_functiondef(v_claim);v_fail_def:=pg_get_functiondef(v_fail);
 IF position('SKIP LOCKED' IN v_claim_def)=0 OR position('deliveryAttempts' IN v_claim_def)=0
  OR position('FOR UPDATE' IN v_fail_def)=0 OR position('9999-12-31' IN v_fail_def)=0 THEN
  RAISE EXCEPTION 'admin group broadcast claim/retry policy is not concurrency-safe';
 END IF;
 IF NOT has_function_privilege('service_role',v_claim,'EXECUTE') OR NOT has_function_privilege('service_role',v_complete,'EXECUTE')
  OR NOT has_function_privilege('service_role',v_fail,'EXECUTE') OR has_function_privilege('anon',v_claim,'EXECUTE')
  OR has_function_privilege('authenticated',v_complete,'EXECUTE') THEN RAISE EXCEPTION 'admin group broadcast RPC grants are invalid';END IF;
END;
$test$;
ROLLBACK;
