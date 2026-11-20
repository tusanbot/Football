CREATE OR REPLACE FUNCTION public.create_friendly_challenge_http(
 p_user_id text,p_gold_cost bigint,p_now timestamptz,p_group_telegram_id text,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE
 v_club public."Club"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE;
 v_existing public."FriendlyChallenge"%ROWTYPE; v_usage public."ChallengeDailyUsage"%ROWTYPE;
 v_wallet public."Wallet"%ROWTYPE; v_challenge public."FriendlyChallenge"%ROWTYPE;
 v_group_id text; v_asset text; v_charged bigint:=0; v_day date;
 v_remaining jsonb; v_challenge_json jsonb;
BEGIN
 IF COALESCE(btrim(p_user_id),'')='' OR p_now IS NULL THEN RAISE EXCEPTION USING MESSAGE='INVALID_USER',ERRCODE='P0001'; END IF;
 IF p_gold_cost IS NULL OR p_gold_cost<=0 THEN RAISE EXCEPTION USING MESSAGE='INVALID_CHALLENGE_PRICE',ERRCODE='P0001'; END IF;
 IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{12,128}$' THEN RAISE EXCEPTION USING MESSAGE='INVALID_IDEMPOTENCY_KEY',ERRCODE='P0001'; END IF;
 SELECT * INTO v_club FROM public."Club" WHERE "ownerId"=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='CLUB_NOT_FOUND',ERRCODE='P0001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('friendly-challenge-key:'||p_idempotency_key,0));
 IF p_group_telegram_id IS NOT NULL AND btrim(p_group_telegram_id)<>'' THEN
  SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_group_telegram_id;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=p_user_id) THEN
   RAISE EXCEPTION USING MESSAGE='GROUP_MEMBERSHIP_REQUIRED',ERRCODE='P0001';
  END IF;
  IF NOT v_group."isActive" OR v_group."isSuspended" THEN RAISE EXCEPTION USING MESSAGE='GROUP_INACTIVE',ERRCODE='P0001'; END IF;
  v_group_id:=v_group.id;
 END IF;
 SELECT * INTO v_existing FROM public."FriendlyChallenge" WHERE "idempotencyKey"=p_idempotency_key FOR UPDATE;
 IF FOUND THEN
  IF v_existing."creatorUserId"<>p_user_id OR v_existing."creatorClubId"<>v_club.id OR v_existing."groupId" IS DISTINCT FROM v_group_id THEN
   RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_CONFLICT',ERRCODE='P0001';
  END IF;
  v_day:=(p_now AT TIME ZONE 'UTC')::date;
  SELECT * INTO v_usage FROM public."ChallengeDailyUsage" WHERE "userId"=p_user_id AND "usageDate"=v_day;
  v_remaining:=jsonb_build_object('free',GREATEST(0,3-COALESCE(v_usage."freeUsed",0)),
   'gold',GREATEST(0,2-COALESCE(v_usage."goldUsed",0)),'purchased',COALESCE(v_usage."purchasedCredits",0));
  v_challenge_json:=to_jsonb(v_existing)||jsonb_build_object('goldCost',v_existing."goldCost"::text);
  RETURN jsonb_build_object('challenge',v_challenge_json,'asset',v_existing."chargeAsset"::text,
   'goldCost',v_existing."goldCost"::text,'remaining',v_remaining,'replayed',true);
 END IF;

 v_day:=(p_now AT TIME ZONE 'UTC')::date;
 INSERT INTO public."ChallengeDailyUsage"(id,"userId","usageDate")
 VALUES('challenge_usage_'||replace(gen_random_uuid()::text,'-',''),p_user_id,v_day)
 ON CONFLICT ("userId","usageDate") DO NOTHING;
 SELECT * INTO v_usage FROM public."ChallengeDailyUsage"
 WHERE "userId"=p_user_id AND "usageDate"=v_day FOR UPDATE;
 IF v_usage."freeUsed"<3 THEN
  v_asset:='FREE';
  UPDATE public."ChallengeDailyUsage" SET "freeUsed"="freeUsed"+1 WHERE id=v_usage.id RETURNING * INTO v_usage;
 ELSIF v_usage."goldUsed"<2 THEN
  SELECT * INTO v_wallet FROM public."Wallet" WHERE "userId"=p_user_id AND asset::text='GOLD' FOR UPDATE;
  IF FOUND AND v_wallet.balance>=p_gold_cost THEN
   UPDATE public."Wallet" SET balance=balance-p_gold_cost,version=version+1,"updatedAt"=p_now
    WHERE id=v_wallet.id AND balance>=p_gold_cost;
   IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='CONCURRENT_MODIFICATION',ERRCODE='P0001'; END IF;
   v_asset:='GOLD'; v_charged:=p_gold_cost;
   INSERT INTO public."LedgerTransaction"(id,"idempotencyKey","userId",asset,direction,amount,reason,"referenceType","referenceId","createdAt")
   VALUES('ledger_'||replace(gen_random_uuid()::text,'-',''),'friendly-challenge:'||p_user_id||':'||p_idempotency_key,
    p_user_id,'GOLD','DEBIT',p_gold_cost,'FRIENDLY_CHALLENGE_CREATE','FRIENDLY_CHALLENGE',p_idempotency_key,p_now);
   UPDATE public."ChallengeDailyUsage" SET "goldUsed"="goldUsed"+1 WHERE id=v_usage.id RETURNING * INTO v_usage;
  ELSIF v_usage."purchasedCredits">0 THEN
   v_asset:='PURCHASED';
   UPDATE public."ChallengeDailyUsage" SET "purchasedCredits"="purchasedCredits"-1 WHERE id=v_usage.id RETURNING * INTO v_usage;
  ELSE RAISE EXCEPTION USING MESSAGE='INSUFFICIENT_GOLD',ERRCODE='P0001';
  END IF;
 ELSIF v_usage."purchasedCredits">0 THEN
  v_asset:='PURCHASED';
  UPDATE public."ChallengeDailyUsage" SET "purchasedCredits"="purchasedCredits"-1 WHERE id=v_usage.id RETURNING * INTO v_usage;
 ELSE RAISE EXCEPTION USING MESSAGE='DAILY_CHALLENGE_LIMIT_REACHED',ERRCODE='P0001';
 END IF;

 INSERT INTO public."FriendlyChallenge"(id,token,"idempotencyKey","chargeAsset","goldCost","creatorUserId","creatorClubId","groupId","expiresAt","createdAt")
 VALUES('friendly_challenge_'||replace(gen_random_uuid()::text,'-',''),
  translate(rtrim(encode(gen_random_bytes(18),'base64'),'='),'+/','-_'),
  p_idempotency_key,v_asset::"ChallengeChargeAsset",v_charged,p_user_id,v_club.id,v_group_id,
  p_now+interval '24 hours',p_now) RETURNING * INTO v_challenge;
 v_remaining:=jsonb_build_object('free',GREATEST(0,3-v_usage."freeUsed"),
  'gold',GREATEST(0,2-v_usage."goldUsed"),'purchased',v_usage."purchasedCredits");
 v_challenge_json:=to_jsonb(v_challenge)||jsonb_build_object('goldCost',v_challenge."goldCost"::text);
 RETURN jsonb_build_object('challenge',v_challenge_json,'asset',v_asset,'goldCost',v_charged::text,'remaining',v_remaining,'replayed',false);
END;$fn$;

CREATE OR REPLACE FUNCTION public.accept_friendly_challenge_http(p_user_id text,p_token text,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE
 v_challenge public."FriendlyChallenge"%ROWTYPE; v_opponent_id text; v_match jsonb; v_group public."TelegramGroup"%ROWTYPE;
 v_creator public."Club"%ROWTYPE; v_match_id text;
BEGIN
 SELECT id INTO v_opponent_id FROM public."Club" WHERE "ownerId"=p_user_id FOR UPDATE;
 IF v_opponent_id IS NULL THEN RAISE EXCEPTION USING MESSAGE='CLUB_NOT_FOUND',ERRCODE='P0001'; END IF;
 SELECT * INTO v_challenge FROM public."FriendlyChallenge" WHERE token=p_token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='FRIENDLY_CHALLENGE_NOT_FOUND',ERRCODE='P0001'; END IF;
 IF v_challenge."creatorUserId"=p_user_id THEN RAISE EXCEPTION USING MESSAGE='CANNOT_ACCEPT_OWN_CHALLENGE',ERRCODE='P0001'; END IF;
 IF v_challenge.status::text='ACCEPTED' AND v_challenge."matchId" IS NOT NULL THEN
  SELECT to_jsonb(m),m."awayClubId" INTO v_match,v_match_id FROM public."FootballMatch" m WHERE m.id=v_challenge."matchId";
  IF v_match IS NULL OR v_match_id<>v_opponent_id THEN RAISE EXCEPTION USING MESSAGE='FRIENDLY_CHALLENGE_ALREADY_ACCEPTED',ERRCODE='P0001'; END IF;
  RETURN jsonb_build_object('match',v_match,'replayed',true);
 END IF;
 IF v_challenge.status::text<>'OPEN' OR v_challenge."expiresAt"<=p_now THEN
  IF v_challenge.status::text='OPEN' AND v_challenge."expiresAt"<=p_now THEN
   UPDATE public."FriendlyChallenge" SET status='EXPIRED' WHERE id=v_challenge.id;
  END IF;
  RAISE EXCEPTION USING MESSAGE='FRIENDLY_CHALLENGE_EXPIRED',ERRCODE='P0001';
 END IF;
 IF v_challenge."groupId" IS NOT NULL THEN
  SELECT * INTO v_group FROM public."TelegramGroup" WHERE id=v_challenge."groupId";
  IF NOT FOUND OR NOT v_group."isActive" OR v_group."isSuspended" THEN RAISE EXCEPTION USING MESSAGE='GROUP_INACTIVE',ERRCODE='P0001'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=v_challenge."groupId" AND "userId"=p_user_id) THEN
   RAISE EXCEPTION USING MESSAGE='GROUP_MEMBERSHIP_REQUIRED',ERRCODE='P0001';
  END IF;
 END IF;
 SELECT * INTO v_creator FROM public."Club" WHERE id=v_challenge."creatorClubId";
 IF NOT FOUND OR (SELECT count(*) FROM public."Player" p WHERE p."clubId"=v_creator.id AND p.status::text='ACTIVE' AND p."suspensionMatchesRemaining"=0)<11
  OR NOT EXISTS(SELECT 1 FROM public."Player" p WHERE p."clubId"=v_creator.id AND p.status::text='ACTIVE' AND p."suspensionMatchesRemaining"=0 AND p.position::text='GK') THEN
  RAISE EXCEPTION USING MESSAGE='ALL_TEAMS_NEED_VALID_LINEUPS',ERRCODE='P0001';
 END IF;
 v_match:=public.create_friendly_match_http(v_challenge."creatorUserId",v_opponent_id,'challenge:'||v_challenge.id,p_now)->'match';
 v_match_id:=v_match->>'id';
 UPDATE public."FriendlyChallenge" SET status='ACCEPTED',"matchId"=v_match_id WHERE id=v_challenge.id AND status='OPEN';
 RETURN jsonb_build_object('match',v_match,'replayed',false);
END;$fn$;

CREATE OR REPLACE FUNCTION public.get_friendly_challenge_info_http(p_token text,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_challenge public."FriendlyChallenge"%ROWTYPE; v_result jsonb;
BEGIN
 SELECT * INTO v_challenge FROM public."FriendlyChallenge" WHERE token=p_token;
 IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='FRIENDLY_CHALLENGE_NOT_FOUND',ERRCODE='P0001'; END IF;
 IF v_challenge.status::text='OPEN' AND v_challenge."expiresAt"<=p_now THEN
  UPDATE public."FriendlyChallenge" SET status='EXPIRED' WHERE id=v_challenge.id AND status='OPEN';
  RAISE EXCEPTION USING MESSAGE='FRIENDLY_CHALLENGE_EXPIRED',ERRCODE='P0001';
 END IF;
 SELECT jsonb_build_object(
  'id',ch.id,'token',ch.token,'status',ch.status::text,'expiresAt',ch."expiresAt",
  'creatorClub',jsonb_build_object('name',cl.name,'level',cl.level,'reputation',cl.reputation),
  'creatorTelegramId',u."telegramId",
  'groupTitle',g.title,'groupTelegramId',g."telegramId"
 ) INTO v_result
 FROM public."FriendlyChallenge" ch
 JOIN public."Club" cl ON cl.id=ch."creatorClubId"
 JOIN public."User" u ON u.id=ch."creatorUserId"
 LEFT JOIN public."TelegramGroup" g ON g.id=ch."groupId"
 WHERE ch.id=v_challenge.id;
 IF v_challenge."groupId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."TelegramGroup" g WHERE g.id=v_challenge."groupId" AND g."isActive" AND NOT g."isSuspended") THEN
  RAISE EXCEPTION USING MESSAGE='GROUP_INACTIVE',ERRCODE='P0001';
 END IF;
 RETURN v_result;
END;$fn$;

CREATE OR REPLACE FUNCTION public.grant_friendly_challenge_credits_http(p_user_id text,p_quantity integer,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_day date; v_usage public."ChallengeDailyUsage"%ROWTYPE;
BEGIN
 IF p_quantity IS NULL OR p_quantity<1 OR p_quantity>100 OR p_now IS NULL THEN RAISE EXCEPTION USING MESSAGE='INVALID_CHALLENGE_CREDIT_QUANTITY',ERRCODE='P0001'; END IF;
 v_day:=(p_now AT TIME ZONE 'UTC')::date;
 INSERT INTO public."ChallengeDailyUsage"(id,"userId","usageDate","purchasedCredits")
 VALUES('challenge_usage_'||replace(gen_random_uuid()::text,'-',''),p_user_id,v_day,p_quantity)
 ON CONFLICT ("userId","usageDate") DO UPDATE SET "purchasedCredits"=public."ChallengeDailyUsage"."purchasedCredits"+EXCLUDED."purchasedCredits"
 RETURNING * INTO v_usage;
 RETURN jsonb_build_object('userId',v_usage."userId",'usageDate',v_usage."usageDate",
  'freeUsed',v_usage."freeUsed",'goldUsed',v_usage."goldUsed",'purchasedCredits',v_usage."purchasedCredits");
END;$fn$;

REVOKE ALL ON FUNCTION public.create_friendly_challenge_http(text,bigint,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.accept_friendly_challenge_http(text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_friendly_challenge_info_http(text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.grant_friendly_challenge_credits_http(text,integer,timestamptz) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.create_friendly_challenge_http(text,bigint,timestamptz,text,text) TO service_role;
  GRANT EXECUTE ON FUNCTION public.accept_friendly_challenge_http(text,text,timestamptz) TO service_role;
  GRANT EXECUTE ON FUNCTION public.get_friendly_challenge_info_http(text,timestamptz) TO service_role;
  GRANT EXECUTE ON FUNCTION public.grant_friendly_challenge_credits_http(text,integer,timestamptz) TO service_role;
 END IF;
END;$grant$;
