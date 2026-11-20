BEGIN;
DO $test$
DECLARE v jsonb; n bigint;
BEGIN
 v:=public.get_admin_console_read_http('overview');
 IF jsonb_typeof(v->'counts')<>'object' OR NOT (v->'counts' ? 'users') OR NOT (v->'counts' ? 'groupTransactions') THEN
  RAISE EXCEPTION 'admin overview response shape invalid: %',v;
 END IF;
 v:=public.get_admin_console_read_http('group-targets');
 IF jsonb_typeof(v->'groups')<>'array' THEN RAISE EXCEPTION 'admin group targets response invalid'; END IF;
 SELECT count(*) INTO n FROM public."TelegramGroup" WHERE "isActive"=true AND "isSuspended"=false;
 IF jsonb_array_length(v->'groups')>LEAST(n,5000) THEN RAISE EXCEPTION 'admin group target limit violated'; END IF;
 BEGIN
  PERFORM public.get_admin_console_read_http('unexpected');
  RAISE EXCEPTION 'invalid admin console view must fail';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 IF has_function_privilege('anon','public.get_admin_console_read_http(text)','EXECUTE')
  OR has_function_privilege('authenticated','public.get_admin_console_read_http(text)','EXECUTE') THEN
  RAISE EXCEPTION 'admin console read RPC exposed to public roles';
 END IF;
END;
$test$;
ROLLBACK;
