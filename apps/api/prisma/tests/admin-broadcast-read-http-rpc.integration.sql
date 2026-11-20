BEGIN;
DO $test$
DECLARE v jsonb; row_value jsonb;
BEGIN
 v:=public.get_admin_broadcasts_http(40);
 IF jsonb_typeof(v)<>'array' THEN RAISE EXCEPTION 'admin broadcast response must be an array'; END IF;
 FOR row_value IN SELECT value FROM jsonb_array_elements(v) LOOP
  IF NOT (row_value ?& ARRAY['id','kind','name','createdByTelegramId','createdAt','total','delivered','skipped','failed','pending'])
   OR row_value->>'kind' NOT IN ('groups','users') THEN
   RAISE EXCEPTION 'admin broadcast row shape invalid: %',row_value;
  END IF;
  IF jsonb_typeof(row_value->'total')<>'number' OR jsonb_typeof(row_value->'pending')<>'number' THEN
   RAISE EXCEPTION 'admin broadcast counters must be numeric: %',row_value;
  END IF;
 END LOOP;
 BEGIN
  PERFORM public.get_admin_broadcasts_http(0);
  RAISE EXCEPTION 'invalid broadcast limit must fail';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 IF has_function_privilege('anon','public.get_admin_broadcasts_http(integer)','EXECUTE')
  OR has_function_privilege('authenticated','public.get_admin_broadcasts_http(integer)','EXECUTE') THEN
  RAISE EXCEPTION 'admin broadcast read RPC exposed to public roles';
 END IF;
END;
$test$;
ROLLBACK;
