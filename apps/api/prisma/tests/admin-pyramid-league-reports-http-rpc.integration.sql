BEGIN;
DO $test$
DECLARE v_now timestamptz:=CURRENT_TIMESTAMP; v_result jsonb;
BEGIN
 INSERT INTO public."User"(id,"telegramId","updatedAt") VALUES('ci-admin-report-user','919900098',v_now AT TIME ZONE 'UTC');
 INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt") VALUES('ci-admin-report-club','ci-admin-report-user','Report Club','ci-admin-report-club',v_now AT TIME ZONE 'UTC');
 INSERT INTO public."Competition"(id,"idempotencyKey",name,season,format,status,"maxTeams","createdByClubId","updatedAt","completedAt")
 VALUES('ci-admin-report-comp','ci-admin-report-key','Report League',2027,'LEAGUE','COMPLETED',8,'ci-admin-report-club',v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC');
 INSERT INTO public."PyramidLeague"(id,"competitionId",tier,season,"groupNumber")
 VALUES('ci-admin-report-league','ci-admin-report-comp',2,2027,1);
 INSERT INTO public."PyramidLeagueEntry"(id,"leagueId","clubId","finalPosition")
 VALUES('ci-admin-report-entry','ci-admin-report-league','ci-admin-report-club',1);
 INSERT INTO public."LeagueAward"(id,"leagueId","clubId",season,tier,placement,"awardName","awardType")
 VALUES('ci-admin-report-award','ci-admin-report-league','ci-admin-report-club',2027,2,1,'Champion','TROPHY');
 INSERT INTO public."AdminAuditLog"(id,"actorTelegramId",action,"targetType","targetId",reason,"idempotencyKey")
 VALUES('ci-admin-report-audit','919900098','pyramid-update-award','league-award','ci-admin-report-award','Report verified','ci-admin-report-audit-key');
 v_result:=public.get_admin_pyramid_league_reports_http(2027,2,'Report',100);
 IF (v_result->'totals'->>'leagues')::integer<>1
  OR (v_result->'totals'->>'completedLeagues')::integer<>1
  OR (v_result->'seasons'->0->>'champions')::integer<>1
  OR v_result->'clubRankings'->0->>'clubId' IS DISTINCT FROM 'ci-admin-report-club'
  OR jsonb_array_length(v_result->'leagueHistory')<>1
  OR jsonb_array_length(v_result->'auditLogs')<>1
  OR v_result->'leagueHistory'->0->>'champion' IS DISTINCT FROM 'Report Club' THEN
  RAISE EXCEPTION 'admin pyramid reports response mismatch: %',v_result;
 END IF;
 IF has_function_privilege('anon','public.get_admin_pyramid_league_reports_http(integer,integer,text,integer)','EXECUTE')
  OR has_function_privilege('authenticated','public.get_admin_pyramid_league_reports_http(integer,integer,text,integer)','EXECUTE') THEN
  RAISE EXCEPTION 'admin pyramid reports RPC exposed to public roles';
 END IF;
END;
$test$;
ROLLBACK;
