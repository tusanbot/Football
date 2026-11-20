BEGIN;
DO $test$
DECLARE v_now timestamptz:=CURRENT_TIMESTAMP; v_result jsonb;
BEGIN
 INSERT INTO public."User"(id,"telegramId","updatedAt") VALUES('ci-admin-pyramid-user','919900099',v_now AT TIME ZONE 'UTC');
 INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt") VALUES('ci-admin-pyramid-club','ci-admin-pyramid-user','Admin Pyramid Club','ci-admin-pyramid-club',v_now AT TIME ZONE 'UTC');
 INSERT INTO public."Competition"(id,"idempotencyKey",name,season,format,status,"maxTeams","createdByClubId","updatedAt")
 VALUES('ci-admin-pyramid-comp','ci-admin-pyramid-key','Admin Pyramid League',2027,'LEAGUE','ACTIVE',8,'ci-admin-pyramid-club',v_now AT TIME ZONE 'UTC');
 INSERT INTO public."PyramidLeague"(id,"competitionId",tier,season,"groupNumber")
 VALUES('ci-admin-pyramid-league','ci-admin-pyramid-comp',1,2027,1);
 INSERT INTO public."PyramidLeagueEntry"(id,"leagueId","clubId")
 VALUES('ci-admin-pyramid-entry','ci-admin-pyramid-league','ci-admin-pyramid-club');
 INSERT INTO public."CompetitionEntry"(id,"competitionId","clubId",played,won,drawn,lost,"goalsFor","goalsAgainst",points)
 VALUES('ci-admin-pyramid-standing','ci-admin-pyramid-comp','ci-admin-pyramid-club',0,0,0,0,0,0,0);
 INSERT INTO public."PyramidLeagueApplication"(id,"userId","clubId",tier,season,status)
 VALUES('ci-admin-pyramid-app','ci-admin-pyramid-user','ci-admin-pyramid-club',1,2027,'QUEUED');
 v_result:=public.get_admin_pyramid_leagues_http(2027,1,'ACTIVE',NULL,60);
 IF jsonb_array_length(v_result->'leagues')<>1 OR jsonb_array_length(v_result->'queues')<>1
  OR v_result->'leagues'->0->>'id' IS DISTINCT FROM 'ci-admin-pyramid-league'
  OR v_result->'leagues'->0->'teams'->0->>'ownerId' IS DISTINCT FROM 'ci-admin-pyramid-user'
  OR (v_result->'applicationCounts'->>'QUEUED')::integer<>1 THEN
  RAISE EXCEPTION 'admin pyramid read response mismatch: %',v_result;
 END IF;
 IF has_function_privilege('anon','public.get_admin_pyramid_leagues_http(integer,integer,text,text,integer)','EXECUTE')
  OR has_function_privilege('authenticated','public.get_admin_pyramid_leagues_http(integer,integer,text,text,integer)','EXECUTE') THEN
  RAISE EXCEPTION 'admin pyramid read RPC exposed to public roles';
 END IF;
END;
$test$;
ROLLBACK;
