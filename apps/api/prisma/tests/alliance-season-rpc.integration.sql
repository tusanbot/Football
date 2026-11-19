BEGIN;
DO $test$
DECLARE
 v_a text:=gen_random_uuid()::text; v_b text:=gen_random_uuid()::text; v_c text:=gen_random_uuid()::text; v_d text:=gen_random_uuid()::text;
 v_ta text:=(100000000000+floor(random()*899999999999)::bigint)::text;
 v_tb text:=(100000000000+floor(random()*899999999999)::bigint)::text; v_tc text:=(100000000000+floor(random()*899999999999)::bigint)::text; v_td text:=(100000000000+floor(random()*899999999999)::bigint)::text;
 v_ga text:='-100'||(100000000000+floor(random()*899999999999)::bigint)::text;
 v_gb text:='-100'||(100000000000+floor(random()*899999999999)::bigint)::text;
 v_now timestamptz:=date_trunc('minute',clock_timestamp())+interval '10 seconds'; v_match_now timestamp without time zone:=localtimestamp-interval '2 minutes'; r jsonb; aid text; sid text; sid2 text; cid text; cid2 text; mid text; clubs text[];
BEGIN
 INSERT INTO public."User"(id,"telegramId","displayName","createdAt","updatedAt","lastActiveAt") VALUES(v_a,v_ta,'Season Founder',v_now,v_now,v_now),(v_b,v_tb,'Season Member',v_now,v_now,v_now);
 INSERT INTO public."User"(id,"telegramId","displayName","createdAt","updatedAt","lastActiveAt") VALUES(v_c,v_tc,'Season Club C',v_now,v_now,v_now),(v_d,v_td,'Season Club D',v_now,v_now,v_now);
 INSERT INTO public."Club"(id,"ownerId",name,slug,"createdAt","updatedAt") VALUES(gen_random_uuid()::text,v_a,'Season Founder FC','season-founder-'||v_a,v_now,v_now),(gen_random_uuid()::text,v_b,'Season Member FC','season-member-'||v_b,v_now,v_now);
 INSERT INTO public."Club"(id,"ownerId",name,slug,"createdAt","updatedAt") VALUES(gen_random_uuid()::text,v_c,'Season Club C FC','season-club-c-'||v_c,v_now,v_now),(gen_random_uuid()::text,v_d,'Season Club D FC','season-club-d-'||v_d,v_now,v_now);
 SELECT ARRAY[(SELECT id FROM public."Club" WHERE "ownerId"=v_a),(SELECT id FROM public."Club" WHERE "ownerId"=v_b),(SELECT id FROM public."Club" WHERE "ownerId"=v_c),(SELECT id FROM public."Club" WHERE "ownerId"=v_d)] INTO clubs;
 INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,attributes,wage,"contractDays","lineupSlot","updatedAt")
 SELECT 'alliance-champ-player-'||c||'-'||p,clubs[c],'Player',p::text,'IR',25,
  CASE WHEN p=11 THEN 'GK'::"PlayerPosition" ELSE 'CB'::"PlayerPosition" END,60,65,'{}'::jsonb,10,365,p,v_now
 FROM generate_series(1,4) c CROSS JOIN generate_series(1,11) p;

 r:=public.register_telegram_group_http(v_ta,v_ga,'Season Founder Group','OWNER',20,v_now);
 r:=public.register_telegram_group_http(v_tb,v_gb,'Season Invitee Group','OWNER',20,v_now);
 UPDATE public."TelegramGroup" SET points=100 WHERE "telegramId"=v_ga;
 r:=public.create_alliance_http(v_ta,v_ga,'Season RPC Alliance','season lifecycle','alliance-season-rpc-0001');
 aid:=r#>>'{alliance,id}';
 r:=public.contribute_alliance_treasury_http(v_ta,v_ga,100,'season-treasury-first-'||substr(v_a,1,12));
 IF r->>'contributed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'first season treasury funding failed: %',r; END IF;
 r:=public.invite_alliance_group_http(v_ta,v_ga,v_gb); sid:=r#>>'{invitation,id}';
 r:=public.respond_alliance_invitation_http(v_tb,v_gb,sid,true);
 r:=public.consume_alliance_action_rate_limit_http(v_ta,v_ga,'alliance-test-action',1,v_now);
 IF r->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'first alliance rate limit attempt denied: %',r; END IF;
 r:=public.consume_alliance_action_rate_limit_http(v_ta,v_ga,'alliance-test-action',1,v_now+interval '20 seconds');
 IF r->>'allowed' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'alliance rate limit did not enforce window: %',r; END IF;
 r:=public.consume_alliance_action_rate_limit_http(v_ta,v_ga,'alliance-test-action',1,v_now+interval '1 minute');
 IF r->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'alliance rate limit did not reset: %',r; END IF;
 r:=public.get_alliance_workspace_http(v_ta,v_ga,true);
 IF r#>>'{alliance,name}'<>'Season RPC Alliance' OR jsonb_array_length(r#>'{alliance,groups}')<>2 OR r#>>'{alliance,canReview}'<>'true' THEN RAISE EXCEPTION 'workspace payload invalid: %',r; END IF;
 r:=public.create_alliance_championship_http(v_ta,v_ga,'Alliance RPC Cup',4,'alliance-champ-create-0001');
 cid:=r#>>'{competition,id}';
 IF cid IS NULL OR r->>'replayed' IS DISTINCT FROM 'false' OR r#>>'{competition,allianceId}'<>aid THEN RAISE EXCEPTION 'alliance championship creation failed: %',r; END IF;
 r:=public.create_alliance_championship_http(v_ta,v_ga,'Alliance RPC Cup',4,'alliance-champ-create-0001');
 IF r->>'replayed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'alliance championship creation replay failed: %',r; END IF;
 r:=public.join_alliance_championship_http(v_tb,v_gb,cid);
 IF r->>'joined' IS DISTINCT FROM 'true' OR r->>'replayed' IS DISTINCT FROM 'false' OR r->>'teams' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'alliance championship join failed: %',r; END IF;
 r:=public.join_alliance_championship_http(v_tb,v_gb,cid);
 IF r->>'replayed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'alliance championship join replay failed: %',r; END IF;
 INSERT INTO public."CompetitionEntry"(id,"competitionId","clubId","joinedAt") VALUES('alliance-champ-extra-c',cid,clubs[3],v_now+interval '1 second'),('alliance-champ-extra-d',cid,clubs[4],v_now+interval '2 seconds');
 r:=public.start_alliance_championship_http(v_ta,v_ga,cid,v_now);
 IF r->>'replayed' IS DISTINCT FROM 'false' OR r->>'fixturesCreated' IS DISTINCT FROM '6' OR r->>'rounds' IS DISTINCT FROM '3' THEN RAISE EXCEPTION 'alliance championship start failed: %',r; END IF;
 r:=public.start_alliance_championship_http(v_ta,v_ga,cid,v_now);
 IF r->>'replayed' IS DISTINCT FROM 'true' OR r->>'fixturesCreated' IS DISTINCT FROM '6' THEN RAISE EXCEPTION 'alliance championship start replay failed: %',r; END IF;
 IF (SELECT count(*) FROM public."AllianceAuditLog" WHERE "allianceId"=aid AND action='CHAMPIONSHIP_STARTED')<>1 THEN RAISE EXCEPTION 'alliance championship start audit was not idempotent'; END IF;

 UPDATE public."AllianceGroup" SET "joinedAt"=v_now-interval '30 minutes' WHERE "allianceId"=aid;
 SELECT id INTO sid FROM public."AllianceSeason" WHERE "allianceId"=aid AND number=1;
 UPDATE public."AllianceSeason" SET "startsAt"=v_now-interval '30 minutes',"endsAt"=v_now-interval '10 minutes' WHERE id=sid;
 INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt")
 VALUES(gen_random_uuid()::text,'season-safe-a-'||v_a,(SELECT id FROM public."TelegramGroup" WHERE "telegramId"=v_ga),NULL,50,'DAILY_ACTIVITY','season test',v_now-interval '20 minutes'),
 (gen_random_uuid()::text,'season-safe-b-'||v_a,(SELECT id FROM public."TelegramGroup" WHERE "telegramId"=v_gb),NULL,50,'GAME_ACTIVITY','season test',v_now-interval '20 minutes');
 r:=public.close_alliance_season_http(v_ta,v_ga);
 IF r->>'reviewStatus' IS DISTINCT FROM 'APPROVED' OR r->>'prize' IS DISTINCT FROM '100' OR r->>'replayed' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'season close/payout failed: %',r; END IF;
 r:=public.close_alliance_season_http(v_ta,v_ga);
 IF r->>'replayed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'season close replay failed: %',r; END IF;
 r:=public.create_alliance_championship_http(v_ta,v_ga,'Alliance RPC Cup',4,'alliance-champ-create-0001');
 IF r->>'replayed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'alliance championship replay after season closure failed: %',r; END IF;
 r:=public.start_alliance_season_http(v_ta,v_ga,7);
 sid2:=r#>>'{season,id}';
 IF sid2 IS NULL OR r#>>'{season,number}'<>'2' THEN RAISE EXCEPTION 'season start failed: %',r; END IF;
 r:=public.contribute_alliance_treasury_http(v_ta,v_ga,100,'season-treasury-next-'||substr(v_a,1,12));
 IF r->>'contributed'<>'true' OR r->>'treasuryPoints' IS DISTINCT FROM '100' THEN RAISE EXCEPTION 'second season treasury funding failed: %',r; END IF;

 -- Attribute clubs to their registering alliance groups and award season points
 -- atomically when an alliance competition match transitions to COMPLETED.
 UPDATE public."AllianceSeason" SET "startsAt"=v_match_now-interval '1 minute',"endsAt"=v_match_now+interval '1 minute' WHERE id=sid2;
 r:=public.create_alliance_championship_http(v_ta,v_ga,'Alliance Season Two Cup',4,'alliance-season-two-cup-0001');
 cid2:=r#>>'{competition,id}';
 r:=public.join_alliance_championship_http(v_tb,v_gb,cid2);
 IF NOT EXISTS(SELECT 1 FROM public."CompetitionEntry" WHERE "competitionId"=cid2 AND "clubId"=clubs[1] AND "allianceGroupId"=(SELECT ag.id FROM public."AllianceGroup" ag JOIN public."TelegramGroup" tg ON tg.id=ag."groupId" WHERE tg."telegramId"=v_ga)) THEN
  RAISE EXCEPTION 'founder competition entry group attribution missing';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public."CompetitionEntry" WHERE "competitionId"=cid2 AND "clubId"=clubs[2] AND "allianceGroupId"=(SELECT ag.id FROM public."AllianceGroup" ag JOIN public."TelegramGroup" tg ON tg.id=ag."groupId" WHERE tg."telegramId"=v_gb)) THEN
  RAISE EXCEPTION 'joining competition entry group attribution missing';
 END IF;
 UPDATE public."Competition" SET status='ACTIVE' WHERE id=cid2;
 mid:='alliance-season-match-'||substr(v_a,1,12);
 INSERT INTO public."FootballMatch"(id,"idempotencyKey",type,status,"homeClubId","awayClubId","competitionId","scheduledAt",seed,"createdAt","updatedAt")
 VALUES(mid,'alliance-season-match-key-'||substr(v_a,1,12),'LEAGUE','IN_PROGRESS',clubs[1],clubs[2],cid2,v_match_now,'alliance-season-test-seed',v_match_now,v_match_now);
 UPDATE public."FootballMatch" SET status='COMPLETED',"homeScore"=2,"awayScore"=0,"completedAt"=v_match_now,"updatedAt"=v_match_now WHERE id=mid;
 UPDATE public."FootballMatch" SET status='COMPLETED',"updatedAt"=v_match_now+interval '1 second' WHERE id=mid;
 IF (SELECT count(*) FROM public."GroupPointLedger" WHERE "idempotencyKey"='alliance-match:'||mid||':'||clubs[1] AND amount=3 AND source::text='LEAGUE_REWARD' AND "userId"=v_a)<>1 THEN
  RAISE EXCEPTION 'alliance match points were not recorded exactly once';
 END IF;
 IF (SELECT points FROM public."TelegramGroup" WHERE "telegramId"=v_ga)<>3 THEN RAISE EXCEPTION 'alliance group balance did not receive match reward'; END IF;

 UPDATE public."AllianceSeason" SET "startsAt"=v_match_now-interval '1 minute',"endsAt"=v_match_now+interval '1 minute' WHERE id=sid2;
 INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt")
 VALUES(gen_random_uuid()::text,'season-flag-'||v_a,(SELECT id FROM public."TelegramGroup" WHERE "telegramId"=v_ga),v_a,100,'DAILY_ACTIVITY','concentrated points',v_match_now+interval '30 seconds');
 r:=public.close_alliance_season_http(v_ta,v_ga);
 IF r#>>'{standings,0,groupId}' IS DISTINCT FROM (SELECT id FROM public."TelegramGroup" WHERE "telegramId"=v_ga)
  OR r#>>'{standings,0,points}' IS DISTINCT FROM '103' THEN
  RAISE EXCEPTION 'alliance match reward was not included in season standings: %',r->'standings';
 END IF;
 IF r->>'reviewStatus' IS DISTINCT FROM 'FLAGGED' OR jsonb_array_length(r->'securityFlags')=0 OR r->>'prize' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'security flag/payout block failed: %',r; END IF;
 r:=public.review_alliance_season_http(v_ta,v_ga,sid2,'APPROVE',true);
 IF r->>'reviewStatus'<>'APPROVED' OR r->>'prize'<>'100' THEN RAISE EXCEPTION 'season review payout failed: %',r; END IF;
 r:=public.review_alliance_season_http(v_ta,v_ga,sid2,'APPROVE',true);
 IF r->>'replayed'<>'true' THEN RAISE EXCEPTION 'season review replay failed: %',r; END IF;
 IF (SELECT count(*) FROM public."AllianceLedger" WHERE "allianceId"=aid AND source='SEASON_CHAMPION_REWARD')<>2 THEN RAISE EXCEPTION 'expected two season payouts'; END IF;
END $test$;
ROLLBACK;
