BEGIN;
DO $test$
DECLARE v jsonb; u_id text; g_id text; c_id text; p_id text;
BEGIN
 SELECT id INTO u_id FROM public."User" LIMIT 1;
 IF u_id IS NOT NULL THEN
  v:=public.admin_moderation_action_http('suspend-user',u_id,'919900096','admin-mod-user-key-01','CI suspend');
  IF v->>'replay'<>'false' OR NOT (SELECT "isSuspended" FROM public."User" WHERE id=u_id) THEN RAISE EXCEPTION 'user suspend failed'; END IF;
  v:=public.admin_moderation_action_http('suspend-user',u_id,'919900096','admin-mod-user-key-01','CI suspend');
  IF v->>'replay'<>'true' THEN RAISE EXCEPTION 'user suspend replay failed'; END IF;
  PERFORM public.admin_moderation_action_http('restore-user',u_id,'919900096','admin-mod-user-key-02',NULL);
 END IF;
 SELECT id INTO g_id FROM public."TelegramGroup" LIMIT 1;
 IF g_id IS NOT NULL THEN
  PERFORM public.admin_moderation_action_http('suspend-group',g_id,'919900096','admin-mod-group-key1',NULL);
  IF NOT (SELECT "isSuspended" FROM public."TelegramGroup" WHERE id=g_id) THEN RAISE EXCEPTION 'group suspend failed'; END IF;
  PERFORM public.admin_moderation_action_http('restore-group',g_id,'919900096','admin-mod-group-key2',NULL);
 END IF;
 SELECT id INTO c_id FROM public."GroupChallenge" WHERE status='OPEN' LIMIT 1;
 IF c_id IS NOT NULL THEN
  v:=public.admin_moderation_action_http('cancel-challenge',c_id,'919900096','admin-mod-challenge1','CI cancel');
  IF (SELECT status FROM public."GroupChallenge" WHERE id=c_id)<>'CANCELLED' THEN RAISE EXCEPTION 'challenge cancel failed'; END IF;
 END IF;
 SELECT id INTO p_id FROM public."Competition" c WHERE NOT EXISTS(SELECT 1 FROM public."PyramidLeague" p WHERE p."competitionId"=c.id) LIMIT 1;
 IF p_id IS NOT NULL THEN
  PERFORM public.admin_moderation_action_http('competition-status',p_id,'919900096','admin-mod-competition1',NULL);
  IF (SELECT status FROM public."Competition" WHERE id=p_id)<>'CANCELLED' THEN RAISE EXCEPTION 'competition cancellation failed'; END IF;
 END IF;
 IF has_function_privilege('anon','public.admin_moderation_action_http(text,text,text,text,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.admin_moderation_action_http(text,text,text,text,text)','EXECUTE') THEN
  RAISE EXCEPTION 'admin moderation RPC exposed to public roles';
 END IF;
END;
$test$;
ROLLBACK;
