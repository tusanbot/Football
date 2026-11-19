BEGIN;
DO $test$
DECLARE
 u1 text:=gen_random_uuid()::text; u2 text:=gen_random_uuid()::text; u3 text:=gen_random_uuid()::text; u4 text:=gen_random_uuid()::text;
 t1 text:=(100000000000+floor(random()*899999999999)::bigint)::text;
 t2 text:=(100000000000+floor(random()*899999999999)::bigint)::text;
 t3 text:=(100000000000+floor(random()*899999999999)::bigint)::text;
 t4 text:=(100000000000+floor(random()*899999999999)::bigint)::text;
 g1 text:='-100'||(100000000000+floor(random()*899999999999)::bigint)::text;
 g2 text:='-100'||(100000000000+floor(random()*899999999999)::bigint)::text;
 g3 text:='-100'||(100000000000+floor(random()*899999999999)::bigint)::text;
 g4 text:='-100'||(100000000000+floor(random()*899999999999)::bigint)::text;
 now_at timestamptz:=date_trunc('minute',clock_timestamp())+interval '10 seconds';
 c1 text; c2 text; c3 text; c4 text; a1 text; a2 text; inv text; comp text; ac text; m text; r jsonb; clubs text[]; home_group text; home_alliance text; home_season text;
BEGIN
 INSERT INTO public."User"(id,"telegramId","displayName","createdAt","updatedAt","lastActiveAt")
 VALUES(u1,t1,'Cross Alliance One',now_at,now_at,now_at),(u2,t2,'Cross Alliance Two',now_at,now_at,now_at),
 (u3,t3,'Cross Alliance Three',now_at,now_at,now_at),(u4,t4,'Cross Alliance Four',now_at,now_at,now_at);
 INSERT INTO public."Club"(id,"ownerId",name,slug,"createdAt","updatedAt")
 VALUES(gen_random_uuid()::text,u1,'Cross Club One','cross-one-'||u1,now_at,now_at),
 (gen_random_uuid()::text,u2,'Cross Club Two','cross-two-'||u2,now_at,now_at),
 (gen_random_uuid()::text,u3,'Cross Club Three','cross-three-'||u3,now_at,now_at),
 (gen_random_uuid()::text,u4,'Cross Club Four','cross-four-'||u4,now_at,now_at);
 SELECT ARRAY[(SELECT id FROM public."Club" WHERE "ownerId"=u1),(SELECT id FROM public."Club" WHERE "ownerId"=u2),(SELECT id FROM public."Club" WHERE "ownerId"=u3),(SELECT id FROM public."Club" WHERE "ownerId"=u4)] INTO clubs;
 INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,attributes,wage,"contractDays","lineupSlot","updatedAt")
 SELECT 'cross-alliance-player-'||c||'-'||p,clubs[c],'Cross','Player '||p,'IR',25,
  CASE WHEN p=11 THEN 'GK'::"PlayerPosition" ELSE 'CB'::"PlayerPosition" END,60,65,'{}'::jsonb,10,365,p,now_at
 FROM generate_series(1,4) c CROSS JOIN generate_series(1,11) p;
 PERFORM public.register_telegram_group_http(t1,g1,'Cross Alliance Group One','OWNER',10,now_at);
 PERFORM public.register_telegram_group_http(t2,g2,'Cross Alliance Group Two','OWNER',10,now_at);
 PERFORM public.register_telegram_group_http(t3,g3,'Cross Alliance Group Three','OWNER',10,now_at);
 PERFORM public.register_telegram_group_http(t4,g4,'Cross Alliance Group Four','OWNER',10,now_at);
 r:=public.create_alliance_http(t1,g1,'Cross Alliance Alpha','first alliance','cross-alpha-alliance-0001'); a1:=r#>>'{alliance,id}';
 r:=public.create_alliance_http(t3,g3,'Cross Alliance Beta','second alliance','cross-beta-alliance-0001'); a2:=r#>>'{alliance,id}';
 r:=public.invite_alliance_group_http(t1,g1,g2); inv:=r#>>'{invitation,id}';
 r:=public.respond_alliance_invitation_http(t2,g2,inv,true);
 r:=public.invite_alliance_group_http(t3,g3,g4); inv:=r#>>'{invitation,id}';
 r:=public.respond_alliance_invitation_http(t4,g4,inv,true);

 r:=public.create_cross_alliance_competition_http(t1,g1,'Inter-Alliance League',4,'cross-alliance-comp-create-01');
 comp:=r#>>'{competition,id}'; ac:=r->>'allianceCompetitionId';
 IF comp IS NULL OR ac IS NULL OR r->>'replayed'<>'false' THEN RAISE EXCEPTION 'cross-alliance competition creation failed: %',r; END IF;
 r:=public.create_cross_alliance_competition_http(t1,g1,'Inter-Alliance League',4,'cross-alliance-comp-create-01');
 IF r->>'replayed'<>'true' THEN RAISE EXCEPTION 'cross-alliance competition idempotency failed: %',r; END IF;
 r:=public.invite_cross_alliance_competition_http(t1,g1,comp,'cross-beta-alliance-0001');
 IF r#>>'{participant,status}'<>'INVITED' THEN RAISE EXCEPTION 'cross-alliance invite failed: %',r; END IF;
 r:=public.respond_cross_alliance_competition_invitation_http(t3,g3,comp,true);
 IF r->>'accepted'<>'true' THEN RAISE EXCEPTION 'cross-alliance invitation acceptance failed: %',r; END IF;
 r:=public.join_cross_alliance_competition_http(t2,g2,comp);
 IF r->>'joined'<>'true' OR r->>'teams'<>'2' THEN RAISE EXCEPTION 'host alliance team join failed: %',r; END IF;
 r:=public.join_cross_alliance_competition_http(t4,g4,comp);
 IF r->>'joined'<>'true' OR r->>'teams'<>'3' THEN RAISE EXCEPTION 'guest alliance team join failed: %',r; END IF;
 r:=public.join_cross_alliance_competition_http(t4,g4,comp);
 IF r->>'replayed'<>'true' THEN RAISE EXCEPTION 'cross-alliance join idempotency failed: %',r; END IF;
 -- The same alliance's second member joins with a fourth club.
 INSERT INTO public."CompetitionEntry"(id,"competitionId","clubId","allianceGroupId","joinedAt")
 SELECT 'cross-alliance-entry-four',comp,clubs[3],ag.id,now_at
 FROM public."AllianceGroup" ag JOIN public."TelegramGroup" tg ON tg.id=ag."groupId" WHERE tg."telegramId"=g3;
 r:=public.start_cross_alliance_competition_http(t1,g1,comp,now_at);
 IF r->>'fixturesCreated'<>'6' OR r->>'allianceCount'<>'2' THEN RAISE EXCEPTION 'cross-alliance competition start failed: %',r; END IF;
 IF (SELECT count(*) FROM public."AllianceCompetitionParticipant" WHERE "allianceCompetitionId"=ac AND status='ACCEPTED' AND "seasonId" IS NOT NULL)<>2 THEN
  RAISE EXCEPTION 'each alliance did not capture its own active season';
 END IF;
 UPDATE public."AllianceSeason" SET "startsAt"=now_at-interval '1 minute',"endsAt"=now_at+interval '1 day'
 WHERE id IN (SELECT "seasonId" FROM public."AllianceCompetitionParticipant" WHERE "allianceCompetitionId"=ac);
 SELECT fm.id INTO m FROM public."FootballMatch" fm WHERE fm."competitionId"=comp ORDER BY fm.round,fm.id LIMIT 1;
 SELECT ag."groupId",ag."allianceId",p."seasonId" INTO home_group,home_alliance,home_season
 FROM public."CompetitionEntry" ce JOIN public."AllianceGroup" ag ON ag.id=ce."allianceGroupId"
 JOIN public."AllianceCompetitionParticipant" p ON p."allianceCompetitionId"=ac AND p."allianceId"=ag."allianceId"
 WHERE ce."competitionId"=comp AND ce."clubId"=(SELECT "homeClubId" FROM public."FootballMatch" WHERE id=m);
 UPDATE public."FootballMatch" SET status='IN_PROGRESS',"startedAt"=now_at WHERE id=m;
 UPDATE public."FootballMatch" SET status='COMPLETED',"homeScore"=2,"awayScore"=0,"completedAt"=now_at,"updatedAt"=now_at WHERE id=m;
 UPDATE public."FootballMatch" SET status='COMPLETED',"updatedAt"=now_at+interval '1 second' WHERE id=m;
 IF (SELECT count(*) FROM public."GroupPointLedger" WHERE "idempotencyKey"='alliance-cross-match:'||m||':'||(SELECT "homeClubId" FROM public."FootballMatch" WHERE id=m) AND "groupId"=home_group AND amount=3 AND source::text='LEAGUE_REWARD')<>1 THEN
  RAISE EXCEPTION 'cross-alliance match reward missing or duplicated for the correct alliance group';
 END IF;
 IF (SELECT "seasonId" FROM public."AllianceCompetitionParticipant" WHERE "allianceCompetitionId"=ac AND "allianceId"=home_alliance) IS DISTINCT FROM home_season THEN
  RAISE EXCEPTION 'participant season snapshot changed unexpectedly';
 END IF;
 IF (SELECT "allianceId" FROM public."AllianceCompetition" WHERE id=ac)<>a1 THEN RAISE EXCEPTION 'host alliance ownership mismatch'; END IF;
 IF has_function_privilege('anon','public.start_cross_alliance_competition_http(text,text,text,timestamptz)','EXECUTE')
  OR has_function_privilege('authenticated','public.start_cross_alliance_competition_http(text,text,text,timestamptz)','EXECUTE') THEN
  RAISE EXCEPTION 'cross-alliance start RPC exposed to public roles';
 END IF;
END $test$;
ROLLBACK;
