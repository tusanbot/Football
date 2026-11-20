BEGIN;
DO $test$
DECLARE v jsonb; actor text:='919900096';
BEGIN
 INSERT INTO public."User"(id,"telegramId") VALUES('ci-admin-broadcast-user','919900096002');
 INSERT INTO public."TelegramGroup"(id,"telegramId",title) VALUES('ci-admin-broadcast-group','-100919900096002','CI broadcast group');
 INSERT INTO public."AdminGroupBroadcast"(id,"idempotencyKey",message,"createdByTelegramId")
 VALUES('ci-admin-broadcast-id','ci-admin-broadcast-key-001','CI retry','919900096');
 INSERT INTO public."AdminGroupBroadcastDelivery"(id,"broadcastId","telegramGroupId","groupTitle","deliveryAttempts","availableAt")
 VALUES('ci-admin-broadcast-delivery','ci-admin-broadcast-id','-100919900096002','CI broadcast group',8,clock_timestamp());
 v:=public.admin_broadcast_retry_http('groups','ci-admin-broadcast-id',actor,'admin-group-broadcast-retry:ci-retry-group-0001');
 IF (v->>'retried')::integer<>1 OR v->>'replayed'<>'false' THEN RAISE EXCEPTION 'group broadcast retry failed: %',v; END IF;
 v:=public.admin_broadcast_retry_http('groups','ci-admin-broadcast-id',actor,'admin-group-broadcast-retry:ci-retry-group-0001');
 IF v->>'replayed'<>'true' OR (v->>'retried')::integer<>1 THEN RAISE EXCEPTION 'group broadcast retry replay failed'; END IF;
 INSERT INTO public."LeagueNotice"(id,"userId",kind,title,body,"referenceId","deliveryAttempts")
 VALUES('ci-admin-user-broadcast-notice','ci-admin-broadcast-user','ADMIN_BROADCAST','CI','CI','ci-user-broadcast-id',8);
 v:=public.admin_broadcast_retry_http('users','ci-user-broadcast-id',actor,'admin-user-broadcast-retry:ci-retry-user-0001');
 IF (v->>'retried')::integer<>1 THEN RAISE EXCEPTION 'user broadcast retry failed: %',v; END IF;
 IF has_function_privilege('anon','public.admin_broadcast_retry_http(text,text,text,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.admin_broadcast_retry_http(text,text,text,text)','EXECUTE') THEN
  RAISE EXCEPTION 'admin broadcast retry RPC exposed to public roles';
 END IF;
END;
$test$;
ROLLBACK;
