BEGIN;
DO $test$
DECLARE v jsonb; u_id text:='ci-admin-mod-user'; g_id text:='ci-admin-mod-group'; c_id text:='ci-admin-mod-challenge'; club_id text:='ci-admin-mod-club'; comp_id text:='ci-admin-mod-competition';
BEGIN
 INSERT INTO public."User"(id,"telegramId","updatedAt") VALUES(u_id,'919900096001',clock_timestamp());
 INSERT INTO public."TelegramGroup"(id,"telegramId",title,points,"isActive") VALUES(g_id,'-100919900096001','CI moderation group',100,true);
 INSERT INTO public."GroupChallenge"(id,"groupId",title,status,"rewardPoints","createdByUserId")
 VALUES(c_id,g_id,'CI moderation challenge','OPEN',7,u_id);
 INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt") VALUES(club_id,u_id,'CI moderation club','ci-admin-moderation-club',clock_timestamp());
 INSERT INTO public."Competition"(id,"idempotencyKey",name,season,"createdByClubId","updatedAt")
 VALUES(comp_id,'ci-admin-mod-competition-key','CI moderation competition',2026,club_id,clock_timestamp());

 v:=public.admin_moderation_action_http('suspend-user',u_id,'919900096','admin-mod-user-key-01','CI suspend');
 IF v->>'replay'<>'false' OR NOT (SELECT "isSuspended" FROM public."User" WHERE id=u_id) THEN RAISE EXCEPTION 'user suspend failed'; END IF;
 v:=public.admin_moderation_action_http('suspend-user',u_id,'919900096','admin-mod-user-key-01','CI suspend');
 IF v->>'replay'<>'true' THEN RAISE EXCEPTION 'user suspend replay failed'; END IF;
 PERFORM public.admin_moderation_action_http('restore-user',u_id,'919900096','admin-mod-user-key-02',NULL);
 IF (SELECT "isSuspended" FROM public."User" WHERE id=u_id) THEN RAISE EXCEPTION 'user restore failed'; END IF;

 PERFORM public.admin_moderation_action_http('suspend-group',g_id,'919900096','admin-mod-group-key1',NULL);
 IF NOT (SELECT "isSuspended" FROM public."TelegramGroup" WHERE id=g_id) THEN RAISE EXCEPTION 'group suspend failed'; END IF;
 PERFORM public.admin_moderation_action_http('restore-group',g_id,'919900096','admin-mod-group-key2',NULL);
 IF (SELECT "isSuspended" FROM public."TelegramGroup" WHERE id=g_id) THEN RAISE EXCEPTION 'group restore failed'; END IF;

 v:=public.admin_moderation_action_http('cancel-challenge',c_id,'919900096','admin-mod-challenge1','CI cancel');
 IF (SELECT status FROM public."GroupChallenge" WHERE id=c_id)<>'CANCELLED' THEN RAISE EXCEPTION 'challenge cancel failed'; END IF;
 IF (SELECT points FROM public."TelegramGroup" WHERE id=g_id)<>107 THEN RAISE EXCEPTION 'challenge reward refund failed'; END IF;
 IF (SELECT count(*) FROM public."GroupPointLedger" WHERE "idempotencyKey"='challenge:'||c_id||':refund')<>1 THEN RAISE EXCEPTION 'challenge refund ledger missing'; END IF;

 PERFORM public.admin_moderation_action_http('competition-status',comp_id,'919900096','admin-mod-competition1',NULL);
 IF (SELECT status FROM public."Competition" WHERE id=comp_id)<>'CANCELLED' THEN RAISE EXCEPTION 'competition cancellation failed'; END IF;

 IF (SELECT count(*) FROM public."AdminAuditLog" WHERE "actorTelegramId"='919900096')<>6 THEN
  RAISE EXCEPTION 'admin moderation audit rows missing: %',(SELECT count(*) FROM public."AdminAuditLog" WHERE "actorTelegramId"='919900096');
 END IF;
 IF has_function_privilege('anon','public.admin_moderation_action_http(text,text,text,text,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.admin_moderation_action_http(text,text,text,text,text)','EXECUTE') THEN
  RAISE EXCEPTION 'admin moderation RPC exposed to public roles';
 END IF;
END;
$test$;
ROLLBACK;
