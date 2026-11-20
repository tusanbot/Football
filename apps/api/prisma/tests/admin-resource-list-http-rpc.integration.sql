BEGIN;
DO $test$
DECLARE v jsonb; r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['players','clubs','users','groups','challenges','leagues','items','gift-codes','alliances','matches','alliance-seasons','season-awards'] LOOP
  v:=public.get_admin_resource_list_http(r,5,NULL,NULL);
  IF jsonb_typeof(v)<>'array' THEN RAISE EXCEPTION 'admin resource % did not return an array',r; END IF;
  IF jsonb_array_length(v)>5 THEN RAISE EXCEPTION 'admin resource % exceeded requested limit',r; END IF;
 END LOOP;
 BEGIN
  PERFORM public.get_admin_resource_list_http('unexpected',10,NULL,NULL);
  RAISE EXCEPTION 'unknown resource must fail';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 BEGIN
  PERFORM public.get_admin_resource_list_http('users',101,NULL,NULL);
  RAISE EXCEPTION 'out-of-range limit must fail';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 IF has_function_privilege('anon','public.get_admin_resource_list_http(text,integer,text,integer)','EXECUTE')
  OR has_function_privilege('authenticated','public.get_admin_resource_list_http(text,integer,text,integer)','EXECUTE') THEN
  RAISE EXCEPTION 'admin resource RPC exposed to public roles';
 END IF;
END;
$test$;
ROLLBACK;
