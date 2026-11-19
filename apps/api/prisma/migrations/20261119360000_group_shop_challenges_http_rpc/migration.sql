-- Group shop and challenge lifecycle over Supabase HTTP RPC.
CREATE OR REPLACE FUNCTION public.list_group_shop_http(p_telegram_user_id text,p_telegram_group_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_user public."User"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE; v_items jsonb;
BEGIN
 IF p_telegram_user_id !~ '^[0-9]{1,20}$' OR p_telegram_group_id !~ '^-?[0-9]{1,20}$' THEN RAISE EXCEPTION USING MESSAGE='INVALID_GROUP_SHOP_REQUEST',ERRCODE='22023'; END IF;
 SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF v_user.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF v_user."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Club" WHERE "ownerId"=v_user.id) THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND'); END IF;
 SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id;
 IF v_group.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF v_group."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_SUSPENDED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_user.id) THEN RETURN jsonb_build_object('error','NOT_GROUP_MEMBER'); END IF;
 INSERT INTO public."GroupRewardItem"(id,slug,name,description,cost,scope,active,"createdAt") VALUES
 (gen_random_uuid()::text,'group-banner','Group Banner','Shared group identity reward',100,'GROUP',true,now()),
 (gen_random_uuid()::text,'member-spotlight','Member Spotlight','Personal member recognition',60,'PERSONAL',true,now()),
 (gen_random_uuid()::text,'club-badge','Club Recognition','Personal club recognition',120,'PERSONAL',true,now())
 ON CONFLICT(slug) DO NOTHING;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('slug',slug,'name',name,'description',description,'cost',cost::text,'scope',scope) ORDER BY cost ASC),'[]'::jsonb)
 INTO v_items FROM public."GroupRewardItem" WHERE active=true;
 RETURN jsonb_build_object('points',v_group.points::text,'items',v_items);
END; $$;

CREATE OR REPLACE FUNCTION public.purchase_group_reward_http(p_telegram_user_id text,p_telegram_group_id text,p_item_slug text,p_recipient_telegram_id text,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_user public."User"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE; v_item public."GroupRewardItem"%ROWTYPE;
 v_recipient public."User"%ROWTYPE; v_membership public."GroupMembership"%ROWTYPE; v_old public."GroupRewardGrant"%ROWTYPE;
 v_grant public."GroupRewardGrant"%ROWTYPE; v_points bigint;
BEGIN
 IF p_telegram_user_id !~ '^[0-9]{1,20}$' OR p_telegram_group_id !~ '^-?[0-9]{1,20}$' OR p_item_slug IS NULL OR length(p_item_slug)>64
 OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{12,128}$' OR (p_recipient_telegram_id IS NOT NULL AND p_recipient_telegram_id !~ '^[0-9]{1,20}$')
 THEN RAISE EXCEPTION USING MESSAGE='INVALID_GROUP_PURCHASE',ERRCODE='22023'; END IF;
 SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id FOR UPDATE;
 IF v_user.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF v_user."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Club" WHERE "ownerId"=v_user.id) THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND'); END IF;
 SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF v_group.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF v_group."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_SUSPENDED'); END IF;
 IF NOT v_group."isActive" THEN RETURN jsonb_build_object('error','GROUP_INACTIVE'); END IF;
 SELECT * INTO v_membership FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_user.id;
 IF v_membership.id IS NULL THEN RETURN jsonb_build_object('error','NOT_GROUP_MEMBER'); END IF;
 IF v_membership.role='MEMBER' THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO v_item FROM public."GroupRewardItem" WHERE slug=p_item_slug AND active=true;
 IF v_item.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_REWARD_NOT_FOUND'); END IF;
 IF v_item.scope='PERSONAL' THEN
  IF p_recipient_telegram_id IS NULL THEN RETURN jsonb_build_object('error','RECIPIENT_REQUIRED'); END IF;
  SELECT * INTO v_recipient FROM public."User" WHERE "telegramId"=p_recipient_telegram_id;
  IF v_recipient.id IS NULL OR NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_recipient.id) THEN RETURN jsonb_build_object('error','RECIPIENT_NOT_GROUP_MEMBER'); END IF;
 ELSE
  IF p_recipient_telegram_id IS NOT NULL THEN RETURN jsonb_build_object('error','GROUP_ITEM_HAS_NO_RECIPIENT'); END IF;
 END IF;
 SELECT * INTO v_old FROM public."GroupRewardGrant" WHERE "idempotencyKey"=p_idempotency_key;
 IF v_old.id IS NOT NULL THEN
  IF v_old."groupId"<>v_group.id OR v_old."itemId"<>v_item.id OR v_old."grantedByUserId"<>v_user.id
   OR v_old."recipientUserId" IS DISTINCT FROM CASE WHEN v_recipient.id IS NULL THEN NULL ELSE v_recipient.id END
  THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); END IF;
  SELECT points INTO v_points FROM public."TelegramGroup" WHERE id=v_group.id;
  RETURN jsonb_build_object('purchased',true,'replayed',true,'item',v_item.name,'grantId',v_old.id,'points',v_points::text);
 END IF;
 UPDATE public."TelegramGroup" SET points=points-v_item.cost WHERE id=v_group.id AND points>=v_item.cost RETURNING points INTO v_points;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','INSUFFICIENT_GROUP_POINTS'); END IF;
 INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt")
 VALUES(gen_random_uuid()::text,'shop:'||p_idempotency_key,v_group.id,v_user.id,-v_item.cost,'SHOP_PURCHASE'::"GroupPointSource",'Purchased '||v_item.name,now());
 INSERT INTO public."GroupRewardGrant"(id,"idempotencyKey","groupId","itemId","grantedByUserId","recipientUserId","createdAt")
 VALUES(gen_random_uuid()::text,p_idempotency_key,v_group.id,v_item.id,v_user.id,v_recipient.id,now()) RETURNING * INTO v_grant;
 RETURN jsonb_build_object('purchased',true,'replayed',false,'item',v_item.name,'grantId',v_grant.id,'points',v_points::text);
END; $$;

CREATE OR REPLACE FUNCTION public.create_group_challenge_http(p_telegram_user_id text,p_telegram_group_id text,p_title text,p_starts_at timestamptz,p_ends_at timestamptz,p_reward_points bigint,p_idempotency_key text,p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_user public."User"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE; v_membership public."GroupMembership"%ROWTYPE; v_old public."GroupChallenge"%ROWTYPE; v_challenge public."GroupChallenge"%ROWTYPE; v_points bigint;
BEGIN
 IF p_telegram_user_id !~ '^[0-9]{1,20}$' OR p_telegram_group_id !~ '^-?[0-9]{1,20}$' OR length(btrim(p_title)) NOT BETWEEN 3 AND 80
 OR p_starts_at IS NULL OR p_ends_at IS NULL OR p_reward_points IS NULL OR p_reward_points<0 OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{12,128}$'
 THEN RAISE EXCEPTION USING MESSAGE='INVALID_GROUP_CHALLENGE',ERRCODE='22023'; END IF;
 SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id FOR UPDATE;
 IF v_user.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF v_user."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Club" WHERE "ownerId"=v_user.id) THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND'); END IF;
 SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF v_group.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF v_group."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_SUSPENDED'); END IF;
 IF NOT v_group."isActive" THEN RETURN jsonb_build_object('error','GROUP_INACTIVE'); END IF;
 SELECT * INTO v_membership FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_user.id;
 IF v_membership.id IS NULL THEN RETURN jsonb_build_object('error','NOT_GROUP_MEMBER'); END IF;
 IF v_membership.role='MEMBER' THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO v_old FROM public."GroupChallenge" WHERE "idempotencyKey"=p_idempotency_key;
 IF v_old.id IS NOT NULL THEN
  IF v_old."groupId"<>v_group.id OR v_old."createdByUserId"<>v_user.id OR v_old.title<>p_title OR v_old."startsAt" IS DISTINCT FROM p_starts_at OR v_old."endsAt" IS DISTINCT FROM p_ends_at OR v_old."rewardPoints"<>p_reward_points
  THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN jsonb_build_object('challenge',jsonb_build_object('id',v_old.id,'title',v_old.title,'status',v_old.status,'rewardPoints',v_old."rewardPoints"::text,'startsAt',v_old."startsAt",'endsAt',v_old."endsAt"),'replayed',true);
 END IF;
 IF p_ends_at<=p_starts_at OR p_starts_at<p_now-interval '1 minute' OR p_ends_at-p_starts_at>interval '30 days' THEN RETURN jsonb_build_object('error','INVALID_CHALLENGE_WINDOW'); END IF;
 IF p_reward_points>v_group.points THEN RETURN jsonb_build_object('error','INVALID_CHALLENGE_REWARD'); END IF;
 IF p_reward_points>0 THEN
  UPDATE public."TelegramGroup" SET points=points-p_reward_points WHERE id=v_group.id AND points>=p_reward_points RETURNING points INTO v_points;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','INSUFFICIENT_GROUP_POINTS'); END IF;
  INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt")
  VALUES(gen_random_uuid()::text,'challenge:'||p_idempotency_key||':reserve',v_group.id,v_user.id,-p_reward_points,'CHALLENGE_REWARD'::"GroupPointSource",'Reserved prize for group challenge',p_now);
 END IF;
 INSERT INTO public."GroupChallenge"(id,"groupId",title,status,"startsAt","endsAt","rewardPoints","createdByUserId","idempotencyKey","createdAt")
 VALUES(gen_random_uuid()::text,v_group.id,btrim(p_title),'OPEN'::"ChallengeStatus",p_starts_at,p_ends_at,p_reward_points,v_user.id,p_idempotency_key,p_now) RETURNING * INTO v_challenge;
 RETURN jsonb_build_object('challenge',jsonb_build_object('id',v_challenge.id,'title',v_challenge.title,'status',v_challenge.status,'rewardPoints',v_challenge."rewardPoints"::text,'startsAt',v_challenge."startsAt",'endsAt',v_challenge."endsAt"),'replayed',false);
END; $$;

CREATE OR REPLACE FUNCTION public.join_group_challenge_http(p_telegram_user_id text,p_telegram_group_id text,p_challenge_id text,p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_user public."User"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE; v_challenge public."GroupChallenge"%ROWTYPE; v_participant_id text; v_replayed boolean:=false;
BEGIN
 SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF v_user.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF v_user."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
 SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id;
 IF v_group.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF v_group."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_SUSPENDED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_user.id) THEN RETURN jsonb_build_object('error','NOT_GROUP_MEMBER'); END IF;
 SELECT * INTO v_challenge FROM public."GroupChallenge" WHERE id=p_challenge_id AND "groupId"=v_group.id FOR UPDATE;
 IF v_challenge.id IS NULL THEN RETURN jsonb_build_object('error','CHALLENGE_NOT_FOUND'); END IF;
 IF v_challenge.status<>'OPEN' OR (v_challenge."startsAt" IS NOT NULL AND v_challenge."startsAt">p_now) OR (v_challenge."endsAt" IS NOT NULL AND v_challenge."endsAt"<=p_now) THEN RETURN jsonb_build_object('error','CHALLENGE_NOT_OPEN'); END IF;
 INSERT INTO public."GroupChallengeParticipant"(id,"challengeId","userId","joinedAt") VALUES(gen_random_uuid()::text,v_challenge.id,v_user.id,p_now)
 ON CONFLICT("challengeId","userId") DO NOTHING RETURNING id INTO v_participant_id;
 IF v_participant_id IS NULL THEN v_replayed:=true; SELECT id INTO v_participant_id FROM public."GroupChallengeParticipant" WHERE "challengeId"=v_challenge.id AND "userId"=v_user.id; END IF;
 RETURN jsonb_build_object('joined',true,'participantId',v_participant_id,'replayed',v_replayed);
END; $$;

CREATE OR REPLACE FUNCTION public.complete_group_challenge_http(p_telegram_user_id text,p_telegram_group_id text,p_challenge_id text,p_winner_telegram_id text,p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_user public."User"%ROWTYPE; v_winner public."User"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE; v_membership public."GroupMembership"%ROWTYPE; v_challenge public."GroupChallenge"%ROWTYPE; v_balance bigint;
BEGIN
 SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF v_user.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF v_group.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF v_group."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_SUSPENDED'); END IF;
 SELECT * INTO v_membership FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_user.id;
 IF v_membership.id IS NULL THEN RETURN jsonb_build_object('error','NOT_GROUP_MEMBER'); END IF;
 IF v_membership.role='MEMBER' THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO v_challenge FROM public."GroupChallenge" WHERE id=p_challenge_id AND "groupId"=v_group.id FOR UPDATE;
 IF v_challenge.id IS NULL THEN RETURN jsonb_build_object('error','CHALLENGE_NOT_FOUND'); END IF;
 IF v_challenge.status='COMPLETED' THEN RETURN jsonb_build_object('completed',true,'replayed',true,'points',v_group.points::text); END IF;
 IF v_challenge.status<>'OPEN' OR (v_challenge."endsAt" IS NOT NULL AND v_challenge."endsAt">p_now) THEN RETURN jsonb_build_object('error','CHALLENGE_NOT_READY'); END IF;
 SELECT * INTO v_winner FROM public."User" WHERE "telegramId"=p_winner_telegram_id;
 IF v_winner.id IS NULL OR NOT EXISTS(SELECT 1 FROM public."GroupChallengeParticipant" WHERE "challengeId"=v_challenge.id AND "userId"=v_winner.id) THEN RETURN jsonb_build_object('error','WINNER_NOT_PARTICIPANT'); END IF;
 UPDATE public."GroupChallenge" SET status='COMPLETED'::"ChallengeStatus" WHERE id=v_challenge.id AND status='OPEN'::"ChallengeStatus";
 IF NOT FOUND THEN RETURN jsonb_build_object('error','CHALLENGE_ALREADY_SETTLED'); END IF;
 IF v_challenge."rewardPoints">0 THEN
  INSERT INTO public."GroupMemberRewardBalance"(id,"groupId","userId",balance,"updatedAt") VALUES(gen_random_uuid()::text,v_group.id,v_winner.id,v_challenge."rewardPoints",p_now)
  ON CONFLICT("groupId","userId") DO UPDATE SET balance=public."GroupMemberRewardBalance".balance+EXCLUDED.balance,"updatedAt"=EXCLUDED."updatedAt" RETURNING balance INTO v_balance;
  INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt")
  VALUES(gen_random_uuid()::text,'challenge:'||v_challenge.id||':winner:'||v_winner.id,v_group.id,v_winner.id,v_challenge."rewardPoints",'CHALLENGE_REWARD'::"GroupPointSource",'Challenge winner reward',p_now)
  ON CONFLICT("idempotencyKey") DO NOTHING;
 END IF;
 RETURN jsonb_build_object('completed',true,'replayed',false,'winnerTelegramId',p_winner_telegram_id,'points',v_group.points::text);
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_group_challenge_http(p_telegram_user_id text,p_telegram_group_id text,p_challenge_id text,p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_user public."User"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE; v_membership public."GroupMembership"%ROWTYPE; v_challenge public."GroupChallenge"%ROWTYPE; v_points bigint;
BEGIN
 SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF v_user.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF v_group.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF v_group."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_SUSPENDED'); END IF;
 SELECT * INTO v_membership FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_user.id;
 IF v_membership.id IS NULL THEN RETURN jsonb_build_object('error','NOT_GROUP_MEMBER'); END IF;
 IF v_membership.role='MEMBER' THEN RETURN jsonb_build_object('error','GROUP_MANAGER_REQUIRED'); END IF;
 SELECT * INTO v_challenge FROM public."GroupChallenge" WHERE id=p_challenge_id AND "groupId"=v_group.id FOR UPDATE;
 IF v_challenge.id IS NULL THEN RETURN jsonb_build_object('error','CHALLENGE_NOT_FOUND'); END IF;
 IF v_challenge.status='CANCELLED' THEN RETURN jsonb_build_object('cancelled',true,'replayed',true,'points',v_group.points::text); END IF;
 IF v_challenge.status<>'OPEN' THEN RETURN jsonb_build_object('error','CHALLENGE_ALREADY_SETTLED'); END IF;
 UPDATE public."GroupChallenge" SET status='CANCELLED'::"ChallengeStatus" WHERE id=v_challenge.id AND status='OPEN'::"ChallengeStatus";
 IF NOT FOUND THEN RETURN jsonb_build_object('error','CHALLENGE_ALREADY_SETTLED'); END IF;
 IF v_challenge."rewardPoints">0 THEN
  UPDATE public."TelegramGroup" SET points=points+v_challenge."rewardPoints" WHERE id=v_group.id RETURNING points INTO v_points;
  INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt")
  VALUES(gen_random_uuid()::text,'challenge:'||v_challenge.id||':refund',v_group.id,v_user.id,v_challenge."rewardPoints",'CHALLENGE_REWARD'::"GroupPointSource",'Refund for cancelled group challenge',p_now)
  ON CONFLICT("idempotencyKey") DO NOTHING;
 ELSE v_points:=v_group.points; END IF;
 RETURN jsonb_build_object('cancelled',true,'replayed',false,'points',v_points::text);
END; $$;

REVOKE ALL ON FUNCTION public.list_group_shop_http(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.purchase_group_reward_http(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_group_challenge_http(text,text,text,timestamptz,timestamptz,bigint,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.join_group_challenge_http(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_group_challenge_http(text,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_group_challenge_http(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.list_group_shop_http(text,text) TO service_role;
  GRANT EXECUTE ON FUNCTION public.purchase_group_reward_http(text,text,text,text,text) TO service_role;
  GRANT EXECUTE ON FUNCTION public.create_group_challenge_http(text,text,text,timestamptz,timestamptz,bigint,text,timestamptz) TO service_role;
  GRANT EXECUTE ON FUNCTION public.join_group_challenge_http(text,text,text,timestamptz) TO service_role;
  GRANT EXECUTE ON FUNCTION public.complete_group_challenge_http(text,text,text,text,timestamptz) TO service_role;
  GRANT EXECUTE ON FUNCTION public.cancel_group_challenge_http(text,text,text,timestamptz) TO service_role;
 END IF;
END; $grant$;
