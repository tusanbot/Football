BEGIN;
DO $test$
DECLARE
 v_a text:=gen_random_uuid()::text; v_b text:=gen_random_uuid()::text;
 v_ta text:=(100000000000+floor(random()*899999999999)::bigint)::text;
 v_tb text:=(100000000000+floor(random()*899999999999)::bigint)::text;
 v_ga text:='-100'||(100000000000+floor(random()*899999999999)::bigint)::text;
 v_gb text:='-100'||(100000000000+floor(random()*899999999999)::bigint)::text;
 v_now timestamptz:=clock_timestamp(); r jsonb; aid text; sid text; sid2 text;
BEGIN
 INSERT INTO public."User"(id,"telegramId","displayName","createdAt","updatedAt","lastActiveAt") VALUES(v_a,v_ta,'Season Founder',v_now,v_now,v_now),(v_b,v_tb,'Season Member',v_now,v_now,v_now);
 INSERT INTO public."Club"(id,"ownerId",name,slug,"createdAt","updatedAt") VALUES(gen_random_uuid()::text,v_a,'Season Founder FC','season-founder-'||v_a,v_now,v_now),(gen_random_uuid()::text,v_b,'Season Member FC','season-member-'||v_b,v_now,v_now);
 r:=public.register_telegram_group_http(v_ta,v_ga,'Season Founder Group','OWNER',20,v_now);
 r:=public.register_telegram_group_http(v_tb,v_gb,'Season Invitee Group','OWNER',20,v_now);
 UPDATE public."TelegramGroup" SET points=100 WHERE "telegramId"=v_ga;
 r:=public.create_alliance_http(v_ta,v_ga,'Season RPC Alliance','season lifecycle','alliance-season-rpc-0001');
 aid:=r#>>'{alliance,id}';
 r:=public.contribute_alliance_treasury_http(v_ta,v_ga,100,'season-treasury-first-'||substr(v_a,1,12));
 IF r->>'contributed'<>'true' THEN RAISE EXCEPTION 'first season treasury funding failed: %',r; END IF;
 r:=public.invite_alliance_group_http(v_ta,v_ga,v_gb); sid:=r#>>'{invitation,id}';
 r:=public.respond_alliance_invitation_http(v_tb,v_gb,sid,true);
 r:=public.get_alliance_workspace_http(v_ta,v_ga,true);
 IF r#>>'{alliance,name}'<>'Season RPC Alliance' OR jsonb_array_length(r#>'{alliance,groups}')<>2 OR r#>>'{alliance,canReview}'<>'true' THEN RAISE EXCEPTION 'workspace payload invalid: %',r; END IF;
 UPDATE public."AllianceGroup" SET "joinedAt"=v_now-interval '30 minutes' WHERE "allianceId"=aid;
 SELECT id INTO sid FROM public."AllianceSeason" WHERE "allianceId"=aid AND number=1;
 UPDATE public."AllianceSeason" SET "startsAt"=v_now-interval '30 minutes',"endsAt"=v_now-interval '10 minutes' WHERE id=sid;
 INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt")
 VALUES(gen_random_uuid()::text,'season-safe-a-'||v_a,(SELECT id FROM public."TelegramGroup" WHERE "telegramId"=v_ga),NULL,50,'DAILY_ACTIVITY','season test',v_now-interval '20 minutes'),
 (gen_random_uuid()::text,'season-safe-b-'||v_a,(SELECT id FROM public."TelegramGroup" WHERE "telegramId"=v_gb),NULL,50,'GAME_ACTIVITY','season test',v_now-interval '20 minutes');
 r:=public.close_alliance_season_http(v_ta,v_ga);
 IF r->>'reviewStatus'<>'APPROVED' OR r->>'prize'<>'100' OR r->>'replayed'<>'false' THEN RAISE EXCEPTION 'season close/payout failed: %',r; END IF;
 r:=public.close_alliance_season_http(v_ta,v_ga);
 IF r->>'replayed'<>'true' THEN RAISE EXCEPTION 'season close replay failed: %',r; END IF;
 r:=public.contribute_alliance_treasury_http(v_ta,v_ga,100,'season-treasury-next-'||substr(v_a,1,12));
 IF r->>'contributed'<>'true' OR r->>'treasuryPoints'<>'100' THEN RAISE EXCEPTION 'second season treasury funding failed: %',r; END IF;
 r:=public.start_alliance_season_http(v_ta,v_ga,7);
 sid2:=r#>>'{season,id}';
 IF sid2 IS NULL OR r#>>'{season,number}'<>'2' THEN RAISE EXCEPTION 'season start failed: %',r; END IF;
 UPDATE public."AllianceSeason" SET "startsAt"=v_now-interval '5 minutes',"endsAt"=v_now-interval '1 minute' WHERE id=sid2;
 INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt")
 VALUES(gen_random_uuid()::text,'season-flag-'||v_a,(SELECT id FROM public."TelegramGroup" WHERE "telegramId"=v_ga),v_a,100,'DAILY_ACTIVITY','concentrated points',v_now-interval '2 minutes');
 r:=public.close_alliance_season_http(v_ta,v_ga);
 IF r->>'reviewStatus'<>'FLAGGED' OR jsonb_array_length(r->'securityFlags')=0 OR r->>'prize'<>'0' THEN RAISE EXCEPTION 'security flag/payout block failed: %',r; END IF;
 r:=public.review_alliance_season_http(v_ta,v_ga,sid2,'APPROVE',true);
 IF r->>'reviewStatus'<>'APPROVED' OR r->>'prize'<>'100' THEN RAISE EXCEPTION 'season review payout failed: %',r; END IF;
 r:=public.review_alliance_season_http(v_ta,v_ga,sid2,'APPROVE',true);
 IF r->>'replayed'<>'true' THEN RAISE EXCEPTION 'season review replay failed: %',r; END IF;
 IF (SELECT count(*) FROM public."AllianceLedger" WHERE "allianceId"=aid AND source='SEASON_CHAMPION_REWARD')<>2 THEN RAISE EXCEPTION 'expected two season payouts'; END IF;
END $test$;
ROLLBACK;
