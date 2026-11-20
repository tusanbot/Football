BEGIN;
INSERT INTO public."User"(id,"telegramId","updatedAt","isSuspended")
VALUES
 ('admin-write-user-1','980000001',clock_timestamp(),false),
 ('admin-write-user-2','980000002',clock_timestamp(),false),
 ('admin-write-user-3','980000003',clock_timestamp(),true);
INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt")
VALUES('admin-write-club-1','admin-write-user-1','Admin Write Club','admin-write-club',clock_timestamp());
INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,attributes,wage,"contractDays","updatedAt")
VALUES('admin-write-player-1','admin-write-club-1','Admin','Player','IR',21,'ST',70,80,'{}'::jsonb,100,365,clock_timestamp());
INSERT INTO public."TelegramGroup"(id,"telegramId",title,"isActive","isSuspended")
VALUES('admin-write-group-1','-100980000001','Admin Write Group',true,false);
DO $test$
DECLARE v jsonb; award_id text; broadcast_id text; n integer;
BEGIN
 v:=public.admin_season_player_award_http('set-season-player-award',NULL,2042,'admin-write-player-1','PLAYER_OF_SEASON','Player of the Season','Manual selection','980000009','admin-season-award-set-01');
 IF v->>'replay'<>'false' OR v->>'targetType'<>'season-player-award' THEN RAISE EXCEPTION 'season award set failed'; END IF;
 award_id:=v->>'targetId';
 v:=public.admin_season_player_award_http('set-season-player-award',NULL,2042,'admin-write-player-1','PLAYER_OF_SEASON','Player of the Season','Manual selection','980000009','admin-season-award-set-01');
 IF v->>'replay'<>'true' OR v->>'targetId'<>award_id THEN RAISE EXCEPTION 'season award set replay failed'; END IF;
 IF (SELECT "awardName" FROM public."SeasonPlayerAward" WHERE id=award_id)<>'Player of the Season' THEN RAISE EXCEPTION 'season award row missing'; END IF;
 v:=public.admin_season_player_award_http('remove-season-player-award',award_id,NULL,NULL,NULL,NULL,'Removal','980000009','admin-season-award-remove-01');
 IF v->>'replay'<>'false' OR EXISTS(SELECT 1 FROM public."SeasonPlayerAward" WHERE id=award_id) THEN RAISE EXCEPTION 'season award removal failed'; END IF;
 v:=public.admin_season_player_award_http('remove-season-player-award',award_id,NULL,NULL,NULL,NULL,'Removal','980000009','admin-season-award-remove-01');
 IF v->>'replay'<>'true' THEN RAISE EXCEPTION 'season award removal replay failed'; END IF;

 v:=public.admin_broadcast_create_http('users','Important user announcement','980000009','admin-user-broadcast-create-01');
 IF v->>'replay'<>'false' OR (v->>'recipients')::integer<>2 THEN RAISE EXCEPTION 'user broadcast creation failed: %',v; END IF;
 broadcast_id:=v->>'targetId';
 v:=public.admin_broadcast_create_http('users','Important user announcement','980000009','admin-user-broadcast-create-01');
 IF v->>'replay'<>'true' OR v->>'targetId'<>broadcast_id OR (v->>'recipients')::integer<>2 THEN RAISE EXCEPTION 'user broadcast replay failed: %',v; END IF;
 SELECT count(*) INTO n FROM public."LeagueNotice" WHERE kind='ADMIN_BROADCAST' AND "referenceId"=broadcast_id;
 IF n<>2 THEN RAISE EXCEPTION 'user broadcast recipients mismatch: %',n; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."AdminAuditLog" WHERE action='broadcast' AND "targetType"='broadcast' AND "targetId"=broadcast_id) THEN RAISE EXCEPTION 'user broadcast audit missing'; END IF;

 v:=public.admin_broadcast_create_http('groups','Important group announcement','980000009','admin-group-broadcast-create-01');
 IF v->>'replay'<>'false' OR (v->>'recipients')::integer<>1 THEN RAISE EXCEPTION 'group broadcast creation failed: %',v; END IF;
 broadcast_id:=v->>'targetId';
 v:=public.admin_broadcast_create_http('groups','Important group announcement','980000009','admin-group-broadcast-create-01');
 IF v->>'replay'<>'true' OR v->>'targetId'<>broadcast_id OR (v->>'recipients')::integer<>1 THEN RAISE EXCEPTION 'group broadcast replay failed: %',v; END IF;
 IF (SELECT count(*) FROM public."AdminGroupBroadcastDelivery" WHERE "broadcastId"=broadcast_id)<>1 THEN RAISE EXCEPTION 'group delivery fanout mismatch'; END IF;
 IF (SELECT count(*) FROM public."AdminAuditLog" WHERE "idempotencyKey" IN ('admin-season-award:admin-season-award-set-01','admin-season-award:admin-season-award-remove-01','admin-broadcast-create:users:admin-user-broadcast-create-01','admin-broadcast-create:groups:admin-group-broadcast-create-01'))<>4 THEN RAISE EXCEPTION 'audit rows missing'; END IF;
 IF has_function_privilege('anon','public.admin_season_player_award_http(text,text,integer,text,text,text,text,text,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.admin_season_player_award_http(text,text,integer,text,text,text,text,text,text)','EXECUTE')
  OR has_function_privilege('anon','public.admin_broadcast_create_http(text,text,text,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.admin_broadcast_create_http(text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'admin write RPC exposed to public roles'; END IF;
END;
$test$;
ROLLBACK;
