-- Group activity, member group listing, and group summary Supabase HTTP RPCs.
CREATE OR REPLACE FUNCTION public.award_group_activity_http(
 p_telegram_user_id text, p_telegram_group_id text, p_activity_type text,
 p_reference_id text DEFAULT NULL, p_now timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $function$
DECLARE v_user public."User"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE;
 v_membership public."GroupMembership"%ROWTYPE; v_cap integer:=3; v_reward integer:=1;
 v_setting_key text; v_key text; v_earned numeric:=0; v_remaining numeric; v_award numeric;
 v_points bigint; v_day date:=((p_now AT TIME ZONE 'UTC')::date);
BEGIN
 IF p_telegram_user_id IS NULL OR p_telegram_user_id !~ '^[0-9]{1,20}$'
 OR p_telegram_group_id IS NULL OR p_telegram_group_id !~ '^-?[0-9]{1,20}$'
 OR p_activity_type NOT IN ('DAILY_ACTIVITY','CHALLENGE_JOIN','CHALLENGE_CREATE','LEAGUE_JOIN','LEAGUE_CREATE','MATCH_PLAYED')
 OR (p_activity_type<>'DAILY_ACTIVITY' AND (p_reference_id IS NULL OR length(p_reference_id)>80 OR p_reference_id !~ '^[A-Za-z0-9:_-]+$'))
 THEN RAISE EXCEPTION USING MESSAGE='INVALID_GROUP_ACTIVITY', ERRCODE='22023'; END IF;
 SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF v_user.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF v_user."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Club" WHERE "ownerId"=v_user.id) THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND'); END IF;
 SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF v_group.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF v_group."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_SUSPENDED'); END IF;
 IF NOT v_group."isActive" THEN RETURN jsonb_build_object('error','GROUP_INACTIVE'); END IF;
 SELECT * INTO v_membership FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_user.id;
 IF v_membership.id IS NULL THEN RETURN jsonb_build_object('error','NOT_GROUP_MEMBER'); END IF;
 SELECT CASE WHEN jsonb_typeof(value)='number' AND (value #>> '{}') ~ '^[0-9]{1,6}$'
   AND (value #>> '{}')::integer BETWEEN 0 AND 100000 THEN (value #>> '{}')::integer END
 INTO v_cap FROM public."GameSetting" WHERE key='groups.dailyPointCap';
 v_cap:=COALESCE(v_cap,3);
 v_setting_key:=CASE p_activity_type
  WHEN 'CHALLENGE_JOIN' THEN 'groups.challengeJoinPoints'
  WHEN 'CHALLENGE_CREATE' THEN 'groups.challengeCreatePoints'
  WHEN 'LEAGUE_JOIN' THEN 'groups.leagueJoinPoints'
  WHEN 'LEAGUE_CREATE' THEN 'groups.leagueCreatePoints'
  WHEN 'MATCH_PLAYED' THEN 'groups.matchPlayedPoints' ELSE 'groups.dailyActivityPoints' END;
 SELECT CASE WHEN jsonb_typeof(value)='number' AND (value #>> '{}') ~ '^[0-9]{1,6}$'
   AND (value #>> '{}')::integer BETWEEN 0 AND 1000 THEN (value #>> '{}')::integer END
 INTO v_reward FROM public."GameSetting" WHERE key=v_setting_key;
 v_reward:=COALESCE(v_reward,CASE p_activity_type WHEN 'MATCH_PLAYED' THEN 2 ELSE 1 END);
 v_key:=CASE WHEN p_activity_type='DAILY_ACTIVITY'
   THEN 'group-daily-activity:'||v_group.id||':'||v_user.id||':'||v_day::text
   ELSE 'group-game:'||v_group.id||':'||v_user.id||':'||v_day::text||':'||p_activity_type||':'||p_reference_id END;
 PERFORM pg_advisory_xact_lock(hashtextextended('group-activity:'||v_group.id||':'||v_user.id||':'||v_day::text,0));
 IF EXISTS(SELECT 1 FROM public."GroupPointLedger" WHERE "idempotencyKey"=v_key) THEN
   SELECT points INTO v_points FROM public."TelegramGroup" WHERE id=v_group.id;
   RETURN jsonb_build_object('awarded',false,'replayed',true,'award','0','points',v_points::text,'dailyCap',v_cap);
 END IF;
 SELECT COALESCE(sum(amount),0) INTO v_earned FROM public."GroupPointLedger"
 WHERE "groupId"=v_group.id AND "userId"=v_user.id AND source IN ('DAILY_ACTIVITY','GAME_ACTIVITY')
 AND amount>0 AND "createdAt">=(p_now AT TIME ZONE 'UTC')::date::timestamp
 AND "createdAt"<((p_now AT TIME ZONE 'UTC')::date+1)::timestamp;
 v_remaining:=v_cap-v_earned;
 IF v_remaining<=0 THEN RETURN jsonb_build_object('awarded',false,'replayed',false,'capped',true,'award','0','points',v_group.points::text,'dailyCap',v_cap); END IF;
 IF v_reward=0 THEN RETURN jsonb_build_object('awarded',false,'replayed',false,'disabled',true,'award','0','points',v_group.points::text,'dailyCap',v_cap); END IF;
 v_award:=LEAST(v_reward,v_remaining);
 INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt")
 VALUES(gen_random_uuid()::text,v_key,v_group.id,v_user.id,v_award,
   CASE WHEN p_activity_type='DAILY_ACTIVITY' THEN 'DAILY_ACTIVITY'::"GroupPointSource" ELSE 'GAME_ACTIVITY'::"GroupPointSource" END,
   CASE WHEN p_activity_type='DAILY_ACTIVITY' THEN 'Daily member activity' ELSE 'Verified group game action: '||p_activity_type END,p_now);
 UPDATE public."TelegramGroup" SET points=points+v_award WHERE id=v_group.id RETURNING points INTO v_points;
 RETURN jsonb_build_object('awarded',true,'replayed',false,'award',v_award::text,'points',v_points::text,'dailyCap',v_cap);
END; $function$;

CREATE OR REPLACE FUNCTION public.list_my_telegram_groups_http(p_telegram_user_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $function$
DECLARE v_user public."User"%ROWTYPE; v_groups jsonb;
BEGIN
 IF p_telegram_user_id IS NULL OR p_telegram_user_id !~ '^[0-9]{1,20}$' THEN RAISE EXCEPTION USING MESSAGE='INVALID_TELEGRAM_USER_ID',ERRCODE='22023'; END IF;
 SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF v_user.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF v_user."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'telegramGroupId',g."telegramId",'title',g.title,'role',m.role,
  'memberCount',g."memberCount",'isActive',g."isActive",'points',g.points::text,
  'lastMemberCountCheckAt',g."lastMemberCountCheckAt") ORDER BY m."joinedAt" DESC),'[]'::jsonb)
 INTO v_groups FROM public."GroupMembership" m JOIN public."TelegramGroup" g ON g.id=m."groupId"
 WHERE m."userId"=v_user.id;
 RETURN jsonb_build_object('groups',v_groups);
END; $function$;

CREATE OR REPLACE FUNCTION public.get_telegram_group_summary_http(p_telegram_user_id text,p_telegram_group_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $function$
DECLARE v_user public."User"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE; v_role "GroupRole";
 v_managers integer; v_minimum integer:=10; v_setting jsonb;
BEGIN
 IF p_telegram_user_id IS NULL OR p_telegram_user_id !~ '^[0-9]{1,20}$'
 OR p_telegram_group_id IS NULL OR p_telegram_group_id !~ '^-?[0-9]{1,20}$'
 THEN RAISE EXCEPTION USING MESSAGE='INVALID_GROUP_SUMMARY_REQUEST',ERRCODE='22023'; END IF;
 SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id;
 IF v_user.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF v_user."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
 SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id;
 IF v_group.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF v_group."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_SUSPENDED'); END IF;
 SELECT role INTO v_role FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_user.id;
 IF v_role IS NULL THEN RETURN jsonb_build_object('error','NOT_GROUP_MEMBER'); END IF;
 SELECT count(*) INTO v_managers FROM public."GroupMembership" WHERE "groupId"=v_group.id AND role IN ('OWNER','ADMIN');
 SELECT value INTO v_setting FROM public."GameSetting" WHERE key='groups.minimumMembers';
 IF jsonb_typeof(v_setting)='number' AND (v_setting #>> '{}') ~ '^[0-9]{1,4}$'
 AND (v_setting #>> '{}')::integer BETWEEN 5 AND 1000 THEN v_minimum:=(v_setting #>> '{}')::integer; END IF;
 RETURN jsonb_build_object('group',jsonb_build_object('id',v_group.id,'telegramId',v_group."telegramId",
  'title',v_group.title,'memberCount',v_group."memberCount",'isActive',v_group."isActive",'points',v_group.points::text),
  'role',v_role,'registeredManagers',v_managers,'minimumMembers',v_minimum);
END; $function$;

REVOKE ALL ON FUNCTION public.award_group_activity_http(text,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_my_telegram_groups_http(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_telegram_group_summary_http(text,text) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.award_group_activity_http(text,text,text,text,timestamptz) TO service_role;
  GRANT EXECUTE ON FUNCTION public.list_my_telegram_groups_http(text) TO service_role;
  GRANT EXECUTE ON FUNCTION public.get_telegram_group_summary_http(text,text) TO service_role;
 END IF;
END; $grant$;
