BEGIN;
SET LOCAL TIME ZONE 'Pacific/Honolulu';
DO $test$
DECLARE
 v_now timestamptz:=now()+interval '1 minute';
 v_create jsonb; v_replay jsonb; v_info jsonb; v_accept jsonb; v_accept_replay jsonb; v_credits jsonb;
 v_token text; v_match_id text; i integer; n integer;
 v_home_positions text[]:=ARRAY['GK','RB','CB','CB','LB','CDM','CM','CM','RW','LW','ST'];
BEGIN
 INSERT INTO public."User"(id,"telegramId","updatedAt") VALUES
 ('ci-challenge-home-user','929900001',v_now AT TIME ZONE 'UTC'),
 ('ci-challenge-away-user','929900002',v_now AT TIME ZONE 'UTC');
 INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt") VALUES
 ('ci-challenge-home-club','ci-challenge-home-user','Challenge Home','ci-challenge-home-club',v_now AT TIME ZONE 'UTC'),
 ('ci-challenge-away-club','ci-challenge-away-user','Challenge Away','ci-challenge-away-club',v_now AT TIME ZONE 'UTC');
 FOR i IN 1..2 LOOP
  FOR n IN 1..11 LOOP
   INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,
    attributes,wage,"contractDays","lineupSlot","createdAt","updatedAt")
   VALUES('ci-challenge-player-'||i||'-'||n,
    CASE WHEN i=1 THEN 'ci-challenge-home-club' ELSE 'ci-challenge-away-club' END,
    'Player',i||'-'||n,'US',22,v_home_positions[n]::"PlayerPosition",60,70,'{}'::jsonb,10,365,n,
    v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC');
  END LOOP;
 END LOOP;
 INSERT INTO public."Wallet"(id,"userId",asset,balance,version,"createdAt","updatedAt")
 VALUES('ci-challenge-wallet','ci-challenge-home-user','GOLD',10000,0,v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC');

 v_create:=public.create_friendly_challenge_http('ci-challenge-home-user',100,v_now,NULL,'friendly-key-0001');
 v_token:=v_create->'challenge'->>'token';
 IF v_create->>'asset' IS DISTINCT FROM 'FREE' OR v_create->>'replayed' IS DISTINCT FROM 'false'
  OR (v_create->'remaining'->>'free')::integer<>2 THEN
  RAISE EXCEPTION 'friendly challenge first creation mismatch: %',v_create;
 END IF;
 v_replay:=public.create_friendly_challenge_http('ci-challenge-home-user',100,v_now,NULL,'friendly-key-0001');
 IF v_replay->>'replayed' IS DISTINCT FROM 'true'
  OR (SELECT "freeUsed" FROM public."ChallengeDailyUsage" WHERE "userId"='ci-challenge-home-user' AND "usageDate"=(v_now AT TIME ZONE 'UTC')::date)<>1 THEN
  RAISE EXCEPTION 'friendly challenge idempotent replay charged usage: %',v_replay;
 END IF;
 PERFORM public.create_friendly_challenge_http('ci-challenge-home-user',100,v_now,NULL,'friendly-key-0002');
 PERFORM public.create_friendly_challenge_http('ci-challenge-home-user',100,v_now,NULL,'friendly-key-0003');
 v_create:=public.create_friendly_challenge_http('ci-challenge-home-user',100,v_now,NULL,'friendly-key-0004');
 IF v_create->>'asset' IS DISTINCT FROM 'GOLD' OR v_create->>'goldCost' IS DISTINCT FROM '100'
  OR (SELECT balance FROM public."Wallet" WHERE id='ci-challenge-wallet')<>9900
  OR (SELECT count(*) FROM public."LedgerTransaction" WHERE "idempotencyKey"='friendly-challenge:ci-challenge-home-user:friendly-key-0004')<>1 THEN
  RAISE EXCEPTION 'friendly challenge gold charge mismatch: %',v_create;
 END IF;

 v_info:=public.get_friendly_challenge_info_http(v_token,v_now);
 IF v_info->>'token' IS DISTINCT FROM v_token OR v_info->'creatorClub'->>'name' IS DISTINCT FROM 'Challenge Home' THEN
  RAISE EXCEPTION 'friendly challenge info mismatch: %',v_info;
 END IF;
 v_accept:=public.accept_friendly_challenge_http('ci-challenge-away-user',v_token,v_now);
 v_match_id:=v_accept->'match'->>'id';
 IF v_accept->>'replayed' IS DISTINCT FROM 'false' OR COALESCE(v_match_id,'')='' THEN
  RAISE EXCEPTION 'friendly challenge acceptance mismatch: %',v_accept;
 END IF;
 v_accept_replay:=public.accept_friendly_challenge_http('ci-challenge-away-user',v_token,v_now);
 IF v_accept_replay->>'replayed' IS DISTINCT FROM 'true' OR v_accept_replay->'match'->>'id' IS DISTINCT FROM v_match_id THEN
  RAISE EXCEPTION 'friendly challenge acceptance replay mismatch: %',v_accept_replay;
 END IF;

 v_credits:=public.grant_friendly_challenge_credits_http('ci-challenge-home-user',5,v_now);
 IF (v_credits->>'purchasedCredits')::integer<>5 THEN RAISE EXCEPTION 'friendly challenge credits mismatch: %',v_credits; END IF;
END;
$test$;
ROLLBACK;
