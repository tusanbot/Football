BEGIN;
DO $test$
DECLARE v jsonb; r jsonb; replay jsonb;
BEGIN
 v:=public.get_admin_configuration_http();
 IF jsonb_typeof(v->'roles')<>'array' OR jsonb_typeof(v->'settings')<>'array' THEN RAISE EXCEPTION 'configuration read response invalid'; END IF;
 r:=public.admin_configuration_action_http('set-admin-role','919900096','admin-config-role-key-001','919900095','moderator');
 IF r->>'replay'<>'false' OR NOT EXISTS(SELECT 1 FROM public."AdminRoleAssignment" WHERE "telegramId"='919900095' AND role='moderator' AND active) THEN
  RAISE EXCEPTION 'admin role upsert failed: %',r;
 END IF;
 replay:=public.admin_configuration_action_http('set-admin-role','919900096','admin-config-role-key-001','919900095','moderator');
 IF replay->>'replay'<>'true' OR (SELECT count(*) FROM public."AdminAuditLog" WHERE "idempotencyKey"='admin-config-role-key-001')<>1 THEN
  RAISE EXCEPTION 'role idempotency replay failed';
 END IF;
 r:=public.admin_configuration_action_http('revoke-admin-role','919900096','admin-config-revoke-key-01','919900095');
 IF EXISTS(SELECT 1 FROM public."AdminRoleAssignment" WHERE "telegramId"='919900095' AND active) THEN RAISE EXCEPTION 'role revoke failed'; END IF;
 r:=public.admin_configuration_action_http('set-game-setting','919900096','admin-config-setting-key-1',NULL,NULL,'groups.minimumMembers','25'::jsonb,'CI setting');
 IF (SELECT value FROM public."GameSetting" WHERE key='groups.minimumMembers')<>'25'::jsonb THEN RAISE EXCEPTION 'game setting upsert failed'; END IF;
 BEGIN
  PERFORM public.admin_configuration_action_http('set-game-setting','919900096','admin-config-setting-key-2',NULL,NULL,'groups.minimumMembers','2'::jsonb,'invalid');
  RAISE EXCEPTION 'out-of-range setting should fail';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
 END;
 IF (SELECT count(*) FROM public."AdminAuditLog" WHERE "actorTelegramId"='919900096')<>3 THEN RAISE EXCEPTION 'admin configuration audit rows missing'; END IF;
 IF has_function_privilege('anon','public.get_admin_configuration_http()','EXECUTE')
  OR has_function_privilege('authenticated','public.admin_configuration_action_http(text,text,text,text,text,text,jsonb,text)','EXECUTE') THEN
  RAISE EXCEPTION 'admin configuration RPC exposed to public roles';
 END IF;
END;
$test$;
ROLLBACK;
