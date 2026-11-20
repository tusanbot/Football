-- Move Telegram group registration and membership onboarding to atomic Supabase RPCs.
CREATE OR REPLACE FUNCTION public.get_group_actor_status_http(p_telegram_user_id text, p_telegram_group_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $function$
DECLARE v_user public."User"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE;
BEGIN
  IF p_telegram_user_id IS NULL OR p_telegram_user_id !~ '^[0-9]{1,20}$'
    OR (p_telegram_group_id IS NOT NULL AND p_telegram_group_id !~ '^-?[0-9]{1,20}$') THEN
    RAISE EXCEPTION USING MESSAGE='INVALID_GROUP_ACTOR_LOOKUP', ERRCODE='22023';
  END IF;
  SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id;
  IF p_telegram_group_id IS NOT NULL THEN SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id; END IF;
  RETURN jsonb_build_object('userExists',v_user.id IS NOT NULL,'userSuspended',COALESCE(v_user."isSuspended",false),
    'groupExists',CASE WHEN p_telegram_group_id IS NULL THEN false ELSE v_group.id IS NOT NULL END,
    'groupSuspended',COALESCE(v_group."isSuspended",false));
END; $function$;

CREATE OR REPLACE FUNCTION public.register_telegram_group_http(
 p_telegram_user_id text,p_telegram_group_id text,p_title text,p_role text,p_member_count integer,p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $function$
DECLARE v_user public."User"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE; v_role "GroupRole";
 v_minimum integer:=10; v_value jsonb; v_registered_managers integer;
BEGIN
 IF p_telegram_user_id IS NULL OR p_telegram_user_id !~ '^[0-9]{1,20}$'
 OR p_telegram_group_id IS NULL OR p_telegram_group_id !~ '^-?[0-9]{1,20}$'
 OR p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 255
 OR p_role IS NULL OR p_role NOT IN ('OWNER','ADMIN')
 OR p_member_count IS NULL OR p_member_count NOT BETWEEN 0 AND 1000000 OR p_now IS NULL THEN
 RAISE EXCEPTION USING MESSAGE='INVALID_GROUP_REGISTRATION', ERRCODE='22023'; END IF;
 SELECT value INTO v_value FROM public."GameSetting" WHERE key='groups.minimumMembers';
 IF jsonb_typeof(v_value)='number' AND (v_value #>> '{}') ~ '^[0-9]{1,4}$' AND (v_value #>> '{}')::integer BETWEEN 5 AND 1000 THEN v_minimum:=(v_value #>> '{}')::integer; END IF;
 IF p_member_count<v_minimum THEN RETURN jsonb_build_object('error','GROUP_MINIMUM_MEMBERS_REQUIRED','minimumMembers',v_minimum); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram-group:'||p_telegram_group_id,0));
 SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id FOR UPDATE;
 IF v_user.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF v_user."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Club" WHERE "ownerId"=v_user.id) THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND'); END IF;
 SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF v_group.id IS NOT NULL AND v_group."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_SUSPENDED'); END IF;
 v_role:=p_role::"GroupRole";
 INSERT INTO public."TelegramGroup"(id,"telegramId",title,"memberCount","isActive","lastMemberCountCheckAt","createdAt")
 VALUES(gen_random_uuid()::text,p_telegram_group_id,btrim(p_title),p_member_count,true,p_now AT TIME ZONE 'UTC',p_now AT TIME ZONE 'UTC')
 ON CONFLICT("telegramId") DO UPDATE SET title=EXCLUDED.title,"memberCount"=EXCLUDED."memberCount","isActive"=true,"lastMemberCountCheckAt"=EXCLUDED."lastMemberCountCheckAt"
 RETURNING * INTO v_group;
 INSERT INTO public."GroupMembership"(id,"groupId","userId",role,"joinedAt")
 VALUES(gen_random_uuid()::text,v_group.id,v_user.id,v_role,p_now AT TIME ZONE 'UTC')
 ON CONFLICT("groupId","userId") DO UPDATE SET role=EXCLUDED.role;
 SELECT count(*) INTO v_registered_managers FROM public."GroupMembership" WHERE "groupId"=v_group.id AND role IN ('OWNER'::"GroupRole",'ADMIN'::"GroupRole");
 RETURN jsonb_build_object('group',jsonb_build_object('id',v_group.id,'telegramId',v_group."telegramId",'title',v_group.title,'memberCount',v_group."memberCount",'isActive',v_group."isActive",'points',v_group.points::text),
 'role',v_role::text,'registeredManagers',v_registered_managers,'minimumMembers',v_minimum);
END; $function$;

CREATE OR REPLACE FUNCTION public.join_telegram_group_http(p_telegram_user_id text,p_telegram_group_id text,p_member_count integer,p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $function$
DECLARE v_user public."User"%ROWTYPE; v_group public."TelegramGroup"%ROWTYPE; v_membership public."GroupMembership"%ROWTYPE;
 v_minimum integer:=10; v_value jsonb; v_registered_managers integer; v_already_joined boolean:=false;
BEGIN
 IF p_telegram_user_id IS NULL OR p_telegram_user_id !~ '^[0-9]{1,20}$'
 OR p_telegram_group_id IS NULL OR p_telegram_group_id !~ '^-?[0-9]{1,20}$'
 OR p_member_count IS NULL OR p_member_count NOT BETWEEN 0 AND 1000000 OR p_now IS NULL THEN
 RAISE EXCEPTION USING MESSAGE='INVALID_GROUP_JOIN', ERRCODE='22023'; END IF;
 SELECT value INTO v_value FROM public."GameSetting" WHERE key='groups.minimumMembers';
 IF jsonb_typeof(v_value)='number' AND (v_value #>> '{}') ~ '^[0-9]{1,4}$' AND (v_value #>> '{}')::integer BETWEEN 5 AND 1000 THEN v_minimum:=(v_value #>> '{}')::integer; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram-group:'||p_telegram_group_id,0));
 IF p_member_count<v_minimum THEN
 UPDATE public."TelegramGroup" SET "memberCount"=p_member_count,"isActive"=false,"lastMemberCountCheckAt"=p_now AT TIME ZONE 'UTC' WHERE "telegramId"=p_telegram_group_id;
 RETURN jsonb_build_object('error','GROUP_MINIMUM_MEMBERS_REQUIRED','minimumMembers',v_minimum); END IF;
 SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id FOR UPDATE;
 IF v_user.id IS NULL THEN RETURN jsonb_build_object('error','ACCOUNT_NOT_FOUND'); END IF;
 IF v_user."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Club" WHERE "ownerId"=v_user.id) THEN RETURN jsonb_build_object('error','CLUB_NOT_FOUND'); END IF;
 SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
 IF v_group.id IS NULL THEN RETURN jsonb_build_object('error','GROUP_NOT_REGISTERED'); END IF;
 IF v_group."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_SUSPENDED'); END IF;
 IF NOT v_group."isActive" THEN RETURN jsonb_build_object('error','GROUP_INACTIVE'); END IF;
 SELECT * INTO v_membership FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_user.id FOR UPDATE;
 v_already_joined:=v_membership.id IS NOT NULL;
 INSERT INTO public."GroupMembership"(id,"groupId","userId",role,"joinedAt")
 VALUES(gen_random_uuid()::text,v_group.id,v_user.id,'MEMBER'::"GroupRole",p_now AT TIME ZONE 'UTC')
 ON CONFLICT("groupId","userId") DO NOTHING RETURNING * INTO v_membership;
 IF v_membership.id IS NULL THEN SELECT * INTO v_membership FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_user.id; END IF;
 UPDATE public."TelegramGroup" SET "memberCount"=p_member_count,"lastMemberCountCheckAt"=p_now AT TIME ZONE 'UTC' WHERE id=v_group.id RETURNING * INTO v_group;
 SELECT count(*) INTO v_registered_managers FROM public."GroupMembership" WHERE "groupId"=v_group.id AND role IN ('OWNER'::"GroupRole",'ADMIN'::"GroupRole");
 RETURN jsonb_build_object('group',jsonb_build_object('id',v_group.id,'telegramId',v_group."telegramId",'title',v_group.title,'isActive',v_group."isActive"),
 'role',v_membership.role::text,'registeredManagers',v_registered_managers,'alreadyJoined',v_already_joined,'memberCount',p_member_count);
END; $function$;

REVOKE ALL ON FUNCTION public.get_group_actor_status_http(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.register_telegram_group_http(text,text,text,text,integer,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.join_telegram_group_http(text,text,integer,timestamptz) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_group_actor_status_http(text,text) TO service_role';
 EXECUTE 'GRANT EXECUTE ON FUNCTION public.register_telegram_group_http(text,text,text,text,integer,timestamptz) TO service_role';
 EXECUTE 'GRANT EXECUTE ON FUNCTION public.join_telegram_group_http(text,text,integer,timestamptz) TO service_role';
 END IF;
END; $grant$;
