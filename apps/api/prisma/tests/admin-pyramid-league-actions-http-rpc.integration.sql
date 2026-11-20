BEGIN;
DO $test$
DECLARE v_now timestamptz:=clock_timestamp(); v_result jsonb; v_replay jsonb; v_expires timestamptz;
BEGIN
 INSERT INTO public."User"(id,"telegramId","updatedAt") VALUES('ci-admin-action-user','919900097',v_now AT TIME ZONE 'UTC');
 INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt") VALUES('ci-admin-action-club','ci-admin-action-user','Action Club','ci-admin-action-club',v_now AT TIME ZONE 'UTC');
 INSERT INTO public."Competition"(id,"idempotencyKey",name,season,format,status,"maxTeams","createdByClubId","updatedAt")
 VALUES('ci-admin-action-comp','ci-admin-action-key','Action League',2027,'LEAGUE','ACTIVE',8,'ci-admin-action-club',v_now AT TIME ZONE 'UTC');
 INSERT INTO public."PyramidLeague"(id,"competitionId",tier,season,"groupNumber")
 VALUES('ci-admin-action-league','ci-admin-action-comp',1,2027,1);
 INSERT INTO public."PyramidLeagueApplication"(id,"userId","clubId",tier,season,status)
 VALUES('ci-admin-action-app','ci-admin-action-user','ci-admin-action-club',1,2027,'QUEUED');
 INSERT INTO public."LeaguePromotionOffer"(id,"leagueId","clubId","targetTier","finalPosition",status,"expiresAt")
 VALUES('ci-admin-action-offer','ci-admin-action-league','ci-admin-action-club',1,1,'PENDING',v_now+interval '1 hour');
 INSERT INTO public."LeagueAward"(id,"leagueId","clubId",season,tier,placement,"awardName","awardType")
 VALUES('ci-admin-action-award','ci-admin-action-league','ci-admin-action-club',2027,1,1,'Initial Award','TROPHY');

 v_result:=public.admin_pyramid_league_action_http('withdraw-application','ci-admin-action-app','919900097','admin-pyramid:withdraw-key-0001','moderation');
 IF v_result->>'replay'<>'false' OR (SELECT status::text FROM public."PyramidLeagueApplication" WHERE id='ci-admin-action-app')<>'WITHDRAWN' THEN
  RAISE EXCEPTION 'application withdrawal failed: %',v_result;
 END IF;
 v_replay:=public.admin_pyramid_league_action_http('withdraw-application','ci-admin-action-app','919900097','admin-pyramid:withdraw-key-0001','moderation');
 IF v_replay->>'replay'<>'true' OR (SELECT count(*) FROM public."AdminAuditLog" WHERE "idempotencyKey"='admin-pyramid:withdraw-key-0001')<>1 THEN
  RAISE EXCEPTION 'idempotent replay failed: %',v_replay;
 END IF;

 v_result:=public.admin_pyramid_league_action_http('extend-promotion-deadline','ci-admin-action-offer','919900097','admin-pyramid:extend-key-0001',NULL,NULL,4);
 SELECT "expiresAt" INTO v_expires FROM public."LeaguePromotionOffer" WHERE id='ci-admin-action-offer';
 IF v_result->>'replay'<>'false' OR v_expires<v_now+interval '4 hours 50 minutes' THEN
  RAISE EXCEPTION 'promotion deadline extension failed: % / %',v_result,v_expires;
 END IF;

 v_result:=public.admin_pyramid_league_action_http('update-award','ci-admin-action-award','919900097','admin-pyramid:award-key-0001','correction',NULL,NULL,'Best Player','GOLD');
 IF (SELECT "awardName" FROM public."LeagueAward" WHERE id='ci-admin-action-award')<>'Best Player'
  OR (SELECT "awardType" FROM public."LeagueAward" WHERE id='ci-admin-action-award')<>'GOLD' THEN
  RAISE EXCEPTION 'award update failed: %',v_result;
 END IF;
 IF (SELECT count(*) FROM public."AdminAuditLog" WHERE "actorTelegramId"='919900097')<>3 THEN
  RAISE EXCEPTION 'audit rows missing';
 END IF;
 IF has_function_privilege('anon','public.admin_pyramid_league_action_http(text,text,text,text,text,text,integer,text,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.admin_pyramid_league_action_http(text,text,text,text,text,text,integer,text,text)','EXECUTE') THEN
  RAISE EXCEPTION 'admin action RPC exposed to public roles';
 END IF;
END;
$test$;
ROLLBACK;
