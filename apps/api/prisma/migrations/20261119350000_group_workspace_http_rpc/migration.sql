-- Complete group workspace read model through Supabase HTTP RPC.
CREATE OR REPLACE FUNCTION public.get_telegram_group_workspace_http(p_telegram_user_id text,p_telegram_group_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $function$
DECLARE
 v_user public."User"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE; v_role "GroupRole";
 v_club_id text; v_balance bigint:=0; v_personal_rewards jsonb; v_personal_history jsonb;
 v_shared_rewards jsonb; v_treasury_history jsonb; v_shop jsonb; v_challenges jsonb; v_leagues jsonb;
BEGIN
 IF p_telegram_user_id IS NULL OR p_telegram_user_id !~ '^[0-9]{1,20}$'
 OR p_telegram_group_id IS NULL OR p_telegram_group_id !~ '^-?[0-9]{1,20}$'
 THEN RAISE EXCEPTION USING MESSAGE='INVALID_GROUP_WORKSPACE_REQUEST',ERRCODE='22023'; END IF;
 SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF v_user.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF v_user."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
 SELECT id INTO v_club_id FROM public."Club" WHERE "ownerId"=v_user.id;
 IF v_club_id IS NULL THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND'); END IF;
 SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id;
 IF v_group.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF v_group."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_SUSPENDED'); END IF;
 SELECT role INTO v_role FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_user.id;
 IF v_role IS NULL THEN RETURN jsonb_build_object('error','NOT_GROUP_MEMBER'); END IF;

 INSERT INTO public."GroupRewardItem"(id,slug,name,description,cost,scope,active,"createdAt")
 VALUES
 (gen_random_uuid()::text,'group-banner','Group Banner','Shared group identity reward',100,'GROUP',true,now()),
 (gen_random_uuid()::text,'member-spotlight','Member Spotlight','Personal member recognition',60,'PERSONAL',true,now()),
 (gen_random_uuid()::text,'club-badge','Club Recognition','Personal club recognition',120,'PERSONAL',true,now())
 ON CONFLICT(slug) DO NOTHING;

 SELECT COALESCE(balance,0) INTO v_balance FROM public."GroupMemberRewardBalance"
 WHERE "groupId"=v_group.id AND "userId"=v_user.id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',g.id,'item',i.name,'description',i.description,'scope',i.scope,'grantedAt',g."createdAt") ORDER BY g."createdAt" DESC),'[]'::jsonb)
 INTO v_personal_rewards FROM public."GroupRewardGrant" g JOIN public."GroupRewardItem" i ON i.id=g."itemId"
 WHERE g."groupId"=v_group.id AND g."recipientUserId"=v_user.id
 AND g."createdAt">now()-interval '365 days';
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',l.id,'amount',l.amount::text,'source',l.source,'description',l.description,'createdAt',l."createdAt") ORDER BY l."createdAt" DESC),'[]'::jsonb)
 INTO v_personal_history FROM (SELECT * FROM public."GroupPointLedger" WHERE "groupId"=v_group.id AND "userId"=v_user.id ORDER BY "createdAt" DESC LIMIT 30) l;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',g.id,'item',i.name,'description',i.description,'grantedAt',g."createdAt") ORDER BY g."createdAt" DESC),'[]'::jsonb)
 INTO v_shared_rewards FROM (SELECT * FROM public."GroupRewardGrant" WHERE "groupId"=v_group.id AND "recipientUserId" IS NULL ORDER BY "createdAt" DESC LIMIT 30) g
 JOIN public."GroupRewardItem" i ON i.id=g."itemId";
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',l.id,'amount',l.amount::text,'source',l.source,'description',l.description,
 'actor',COALESCE(u."displayName",u."telegramId",'System'),'createdAt',l."createdAt") ORDER BY l."createdAt" DESC),'[]'::jsonb)
 INTO v_treasury_history FROM (SELECT * FROM public."GroupPointLedger" WHERE "groupId"=v_group.id ORDER BY "createdAt" DESC LIMIT 30) l
 LEFT JOIN public."User" u ON u.id=l."userId";
 SELECT COALESCE(jsonb_agg(jsonb_build_object('slug',slug,'name',name,'description',description,'cost',cost::text,'scope',scope) ORDER BY cost ASC),'[]'::jsonb)
 INTO v_shop FROM public."GroupRewardItem" WHERE active=true;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'status',c.status,
 'startsAt',c."startsAt",'endsAt',c."endsAt",'rewardPoints',c."rewardPoints"::text,
 'participants',(SELECT count(*) FROM public."GroupChallengeParticipant" p WHERE p."challengeId"=c.id),
 'joined',EXISTS(SELECT 1 FROM public."GroupChallengeParticipant" p WHERE p."challengeId"=c.id AND p."userId"=v_user.id),
 'createdByMe',c."createdByUserId"=v_user.id) ORDER BY c."createdAt" DESC),'[]'::jsonb)
 INTO v_challenges FROM (SELECT * FROM public."GroupChallenge" WHERE "groupId"=v_group.id ORDER BY "createdAt" DESC LIMIT 30) c;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'status',c.status,'maxTeams',c."maxTeams",
 'teams',(SELECT count(*) FROM public."CompetitionEntry" e WHERE e."competitionId"=c.id),
 'joined',EXISTS(SELECT 1 FROM public."CompetitionEntry" e WHERE e."competitionId"=c.id AND e."clubId"=v_club_id),
 'createdByMe',c."createdByClubId"=v_club_id) ORDER BY c."createdAt" DESC),'[]'::jsonb)
 INTO v_leagues FROM (SELECT * FROM public."Competition" WHERE "groupId"=v_group.id ORDER BY "createdAt" DESC LIMIT 20) c;

 RETURN jsonb_build_object(
  'group',jsonb_build_object('telegramGroupId',v_group."telegramId",'title',v_group.title,'role',v_role,
   'memberCount',v_group."memberCount",'isActive',v_group."isActive",'points',v_group.points::text,
   'lastMemberCountCheckAt',v_group."lastMemberCountCheckAt"),
  'personal',jsonb_build_object('points',COALESCE(v_balance,0)::text,'rewards',v_personal_rewards,'history',v_personal_history),
  'sharedRewards',v_shared_rewards,'treasuryHistory',v_treasury_history,'shop',v_shop,'challenges',v_challenges,'leagues',v_leagues
 );
END; $function$;
REVOKE ALL ON FUNCTION public.get_telegram_group_workspace_http(text,text) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.get_telegram_group_workspace_http(text,text) TO service_role;
 END IF;
END; $grant$;
