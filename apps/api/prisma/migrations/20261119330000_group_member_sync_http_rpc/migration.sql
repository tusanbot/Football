-- Supabase HTTP operations for Telegram member synchronization and member-count checks.
CREATE OR REPLACE FUNCTION public.sync_telegram_group_member_http(
  p_telegram_group_id text, p_telegram_user_id text, p_is_member boolean, p_role text DEFAULT 'MEMBER'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $function$
DECLARE v_group public."TelegramGroup"%ROWTYPE; v_user public."User"%ROWTYPE; v_role "GroupRole";
BEGIN
  IF p_telegram_group_id IS NULL OR p_telegram_group_id !~ '^-?[0-9]{1,20}$'
    OR p_telegram_user_id IS NULL OR p_telegram_user_id !~ '^[0-9]{1,20}$'
    OR p_is_member IS NULL OR p_role NOT IN ('OWNER','ADMIN','MEMBER') THEN
    RAISE EXCEPTION USING MESSAGE='INVALID_GROUP_MEMBER_UPDATE', ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('telegram-group:'||p_telegram_group_id,0));
  SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
  SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id;
  IF v_group.id IS NULL OR v_user.id IS NULL THEN RETURN jsonb_build_object('updated',false,'isMember',p_is_member); END IF;
  IF v_group."isSuspended" THEN RETURN jsonb_build_object('error','GROUP_SUSPENDED'); END IF;
  IF v_user."isSuspended" THEN RETURN jsonb_build_object('error','ACCOUNT_SUSPENDED'); END IF;
  IF p_is_member THEN
    v_role:=p_role::"GroupRole";
    INSERT INTO public."GroupMembership"(id,"groupId","userId",role,"joinedAt")
    VALUES(gen_random_uuid()::text,v_group.id,v_user.id,v_role,now())
    ON CONFLICT("groupId","userId") DO UPDATE SET role=EXCLUDED.role;
  ELSE
    DELETE FROM public."GroupMembership" WHERE "groupId"=v_group.id AND "userId"=v_user.id;
  END IF;
  RETURN jsonb_build_object('updated',true,'isMember',p_is_member);
END; $function$;

CREATE OR REPLACE FUNCTION public.check_telegram_group_members_http(
  p_telegram_group_id text, p_member_count integer, p_bot_present boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $function$
DECLARE v_group public."TelegramGroup"%ROWTYPE; v_minimum integer:=10; v_value jsonb; v_active boolean;
BEGIN
  IF p_telegram_group_id IS NULL OR p_telegram_group_id !~ '^-?[0-9]{1,20}$'
    OR p_member_count IS NULL OR p_member_count NOT BETWEEN 0 AND 1000000 OR p_bot_present IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='INVALID_GROUP_CHECK', ERRCODE='22023';
  END IF;
  SELECT value INTO v_value FROM public."GameSetting" WHERE key='groups.minimumMembers';
  IF jsonb_typeof(v_value)='number' AND (v_value #>> '{}') ~ '^[0-9]{1,4}$'
    AND (v_value #>> '{}')::integer BETWEEN 5 AND 1000 THEN v_minimum:=(v_value #>> '{}')::integer; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('telegram-group:'||p_telegram_group_id,0));
  SELECT * INTO v_group FROM public."TelegramGroup" WHERE "telegramId"=p_telegram_group_id FOR UPDATE;
  IF v_group.id IS NULL THEN
    RETURN jsonb_build_object('found',false,'isActive',false,'memberCount',p_member_count,'minimumMembers',v_minimum);
  END IF;
  v_active:=p_member_count>=v_minimum AND p_bot_present AND NOT v_group."isSuspended";
  UPDATE public."TelegramGroup" SET "memberCount"=p_member_count,"isActive"=v_active,
    "lastMemberCountCheckAt"=now() WHERE id=v_group.id;
  RETURN jsonb_build_object('found',true,'isActive',v_active,'memberCount',p_member_count,'minimumMembers',v_minimum);
END; $function$;

REVOKE ALL ON FUNCTION public.sync_telegram_group_member_http(text,text,boolean,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.check_telegram_group_members_http(text,integer,boolean) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.sync_telegram_group_member_http(text,text,boolean,text) TO service_role;
  GRANT EXECUTE ON FUNCTION public.check_telegram_group_members_http(text,integer,boolean) TO service_role;
 END IF;
END; $grant$;
