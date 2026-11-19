BEGIN;
SET LOCAL TIME ZONE 'Pacific/Honolulu';
DO $test$
DECLARE
 u text[]:=ARRAY['ci-adv-user-1','ci-adv-user-2','ci-adv-user-3','ci-adv-user-4'];
 c text[]:=ARRAY['ci-adv-club-1','ci-adv-club-2','ci-adv-club-3','ci-adv-club-4'];
 cup text:='ci-adv-cup'; league text:='ci-adv-league'; r jsonb;
BEGIN
 INSERT INTO public."User"(id,"telegramId","updatedAt")
 SELECT u[i],'ci-adv-tg-'||i,now() AT TIME ZONE 'UTC' FROM generate_subscripts(u,1)i ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt")
 SELECT c[i],u[i],'Advancement Club '||i,'ci-adv-club-'||i,now() AT TIME ZONE 'UTC'
 FROM generate_subscripts(c,1)i ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."Competition"(id,"idempotencyKey",name,season,format,status,"maxTeams","cupLegs","createdByClubId",rules,"updatedAt")
 VALUES(cup,'ci-adv-cup-key','CI Advancement Cup',2026,'CUP','ACTIVE',4,2,c[1],'{"penaltiesOnDraw":true}',now() AT TIME ZONE 'UTC') ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."CompetitionEntry"(id,"competitionId","clubId")
 SELECT 'ci-adv-entry-'||i,cup,c[i] FROM generate_subscripts(c,1)i ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."FootballMatch"(id,"idempotencyKey",type,status,"homeClubId","awayClubId","competitionId",round,"tieId",leg,
 "scheduledAt",seed,"homeScore","awayScore","winnerClubId","updatedAt") VALUES
 ('ci-adv-m1','ci-adv-m1-key','CUP','COMPLETED',c[1],c[2],cup,1,'ci-adv-tie-1',1,now(),'m1',1,0,NULL,now() AT TIME ZONE 'UTC'),
 ('ci-adv-m2','ci-adv-m2-key','CUP','COMPLETED',c[2],c[1],cup,1,'ci-adv-tie-1',2,now(),'m2',0,2,c[1],now() AT TIME ZONE 'UTC'),
 ('ci-adv-m3','ci-adv-m3-key','CUP','COMPLETED',c[3],c[4],cup,1,'ci-adv-tie-2',1,now(),'m3',2,0,NULL,now() AT TIME ZONE 'UTC'),
 ('ci-adv-m4','ci-adv-m4-key','CUP','SCHEDULED',c[4],c[3],cup,1,'ci-adv-tie-2',2,now(),'m4',0,1,NULL,now() AT TIME ZONE 'UTC')
 ON CONFLICT(id) DO NOTHING;
 r:=public.advance_competition_after_match_http(cup,1,now());
 IF r->>'roundComplete'<>'false' OR (SELECT count(*) FROM public."FootballMatch" WHERE "competitionId"=cup AND round=2)<>0
 THEN RAISE EXCEPTION 'incomplete cup round advanced: %',r; END IF;
 UPDATE public."FootballMatch" SET status='COMPLETED',"winnerClubId"=c[3] WHERE id='ci-adv-m4';
 r:=public.advance_competition_after_match_http(cup,1,now());
 IF (r->>'fixturesCreated')::integer<>2 OR (r->>'nextRound')::integer<>2 OR r->>'completed'<>'false'
 THEN RAISE EXCEPTION 'cup progression mismatch: %',r; END IF;
 IF (SELECT count(*) FROM public."FootballMatch" WHERE "competitionId"=cup AND round=2 AND "tieId" IS NOT NULL)<>2
 OR (SELECT count(*) FROM public."FootballMatch" WHERE "competitionId"=cup AND round=2 AND leg IN(1,2))<>2
 THEN RAISE EXCEPTION 'two-leg fixture generation mismatch'; END IF;
 r:=public.advance_competition_after_match_http(cup,1,now());
 IF r->>'replayed'<>'true' OR (SELECT count(*) FROM public."FootballMatch" WHERE "competitionId"=cup AND round=2)<>2
 THEN RAISE EXCEPTION 'cup progression replay mismatch: %',r; END IF;
 UPDATE public."FootballMatch" SET status='COMPLETED',"winnerClubId"=c[1] WHERE "competitionId"=cup AND round=2;
 r:=public.advance_competition_after_match_http(cup,2,now());
 IF r->>'completed'<>'true' OR (SELECT status::text FROM public."Competition" WHERE id=cup)<>'COMPLETED'
 THEN RAISE EXCEPTION 'cup finalization mismatch: %',r; END IF;

 INSERT INTO public."Competition"(id,"idempotencyKey",name,season,format,status,"maxTeams","createdByClubId","updatedAt")
 VALUES(league,'ci-adv-league-key','CI Advancement League',2026,'LEAGUE','ACTIVE',4,c[1],now() AT TIME ZONE 'UTC') ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."CompetitionEntry"(id,"competitionId","clubId") VALUES('ci-adv-le1',league,c[1]),('ci-adv-le2',league,c[2]) ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."FootballMatch"(id,"idempotencyKey",type,status,"homeClubId","awayClubId","competitionId",round,"scheduledAt",seed,
 "homeScore","awayScore","updatedAt") VALUES('ci-adv-lm','ci-adv-lm-key','LEAGUE','COMPLETED',c[1],c[2],league,1,now(),'lm',2,0,now() AT TIME ZONE 'UTC')
 ON CONFLICT(id) DO NOTHING;
 r:=public.advance_competition_after_match_http(league,1,now());
 IF (r->>'noticesCreated')::integer<>2 OR r->>'roundComplete'<>'true'
 THEN RAISE EXCEPTION 'league round notice mismatch: %',r; END IF;
 IF (SELECT count(*) FROM public."LeagueNotice" WHERE "dedupeKey" LIKE 'league-round:'||league||':1:%')<>2
 THEN RAISE EXCEPTION 'league notices missing'; END IF;
 r:=public.advance_competition_after_match_http(league,1,now());
 IF (SELECT count(*) FROM public."LeagueNotice" WHERE "dedupeKey" LIKE 'league-round:'||league||':1:%')<>2
 THEN RAISE EXCEPTION 'league notice replay duplicated'; END IF;
END;
$test$;
ROLLBACK;
