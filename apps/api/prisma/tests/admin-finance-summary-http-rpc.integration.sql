BEGIN;
DO $test$
DECLARE v jsonb;
BEGIN
 v:=public.get_admin_finance_summary_http(30);
 IF (v->>'days')::integer<>30 OR jsonb_typeof(v->'wallet')<>'array'
  OR jsonb_typeof(v->'clubFinance')<>'array' OR jsonb_typeof(v->'groupPoints')<>'array'
  OR jsonb_typeof(v->'walletReconciliation')<>'array' OR jsonb_typeof(v->'groupReconciliation')<>'array'
  OR jsonb_typeof(v->'clubFinanceSummary')<>'array' OR v->>'clubArrearsTotal' IS NULL THEN
  RAISE EXCEPTION 'admin finance response shape invalid: %',v;
 END IF;
 BEGIN
  PERFORM public.get_admin_finance_summary_http(0);
  RAISE EXCEPTION 'invalid finance period must fail';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 IF has_function_privilege('anon','public.get_admin_finance_summary_http(integer)','EXECUTE')
  OR has_function_privilege('authenticated','public.get_admin_finance_summary_http(integer)','EXECUTE') THEN
  RAISE EXCEPTION 'admin finance RPC exposed to public roles';
 END IF;
END;
$test$;
ROLLBACK;
