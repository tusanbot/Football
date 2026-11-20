BEGIN;
DO $test$
DECLARE v jsonb;
BEGIN
 FOREACH v IN ARRAY ARRAY[
  public.get_admin_ledger_entries_http('wallet-ledger',10,NULL),
  public.get_admin_ledger_entries_http('group-ledger',10,NULL),
  public.get_admin_ledger_entries_http('audit',10,NULL)
 ] LOOP
  IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>10 THEN
   RAISE EXCEPTION 'admin ledger read response invalid: %',v;
  END IF;
 END LOOP;
 BEGIN
  PERFORM public.get_admin_ledger_entries_http('unknown',10,NULL);
  RAISE EXCEPTION 'invalid admin ledger resource must fail';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 BEGIN
  PERFORM public.get_admin_ledger_entries_http(NULL,10,NULL);
  RAISE EXCEPTION 'null admin ledger resource must fail';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 BEGIN
  PERFORM public.get_admin_ledger_entries_http('audit',101,NULL);
  RAISE EXCEPTION 'oversized admin ledger limit must fail';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 BEGIN
  PERFORM public.get_admin_ledger_entries_http('audit',10,repeat('x',101));
  RAISE EXCEPTION 'oversized admin ledger query must fail';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 IF has_function_privilege('anon','public.get_admin_ledger_entries_http(text,integer,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.get_admin_ledger_entries_http(text,integer,text)','EXECUTE') THEN
  RAISE EXCEPTION 'admin ledger read RPC exposed to public roles';
 END IF;
END;
$test$;
ROLLBACK;
