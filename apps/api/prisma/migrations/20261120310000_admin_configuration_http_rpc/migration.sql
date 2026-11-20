CREATE OR REPLACE FUNCTION public.get_admin_configuration_http()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
 SELECT jsonb_build_object(
  'roles',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'telegramId',r."telegramId",'role',r.role,'active',r.active,'createdByTelegramId',r."createdByTelegramId",'updatedByTelegramId',r."updatedByTelegramId",'createdAt',r."createdAt",'updatedAt',r."updatedAt") ORDER BY r."updatedAt" DESC) FROM public."AdminRoleAssignment" r),'[]'::jsonb),
  'settings',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'key',s.key,'value',s.value,'description',s.description,'updatedByTelegramId',s."updatedByTelegramId",'createdAt',s."createdAt",'updatedAt',s."updatedAt") ORDER BY s.key ASC) FROM public."GameSetting" s),'[]'::jsonb)
 );
$fn$;

CREATE OR REPLACE FUNCTION public.admin_configuration_action_http(
 p_action text,p_actor_telegram_id text,p_idempotency_key text,
 p_target_telegram_id text DEFAULT NULL,p_role text DEFAULT NULL,
 p_setting_key text DEFAULT NULL,p_setting_value jsonb DEFAULT NULL,p_setting_description text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE
 v_existing public."AdminAuditLog"%ROWTYPE;
 v_id text;
 v_metadata jsonb;
 v_limits jsonb;
 v_min numeric;
 v_max numeric;
 v_value numeric;
BEGIN
 IF p_action NOT IN ('set-admin-role','revoke-admin-role','set-game-setting')
  OR p_actor_telegram_id IS NULL OR p_actor_telegram_id !~ '^[0-9]{1,20}$'
  OR p_idempotency_key IS NULL OR length(p_idempotency_key)<12 OR length(p_idempotency_key)>160 THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_CONFIGURATION_ACTION',ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
 SELECT * INTO v_existing FROM public."AdminAuditLog" WHERE "idempotencyKey"=p_idempotency_key;
 IF FOUND THEN
  IF v_existing."actorTelegramId"=p_actor_telegram_id AND v_existing.action=p_action
   AND v_existing."targetId"=COALESCE(p_target_telegram_id,p_setting_key,'')
   AND v_existing.metadata IS NOT DISTINCT FROM CASE
    WHEN p_action IN ('set-admin-role','revoke-admin-role') THEN jsonb_build_object('telegramId',p_target_telegram_id,'role',p_role)
    ELSE jsonb_build_object('key',p_setting_key,'value',p_setting_value) END THEN
   RETURN jsonb_build_object('ok',true,'targetType',v_existing."targetType",'targetId',v_existing."targetId",'replay',true);
  END IF;
  RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_KEY_REUSED',ERRCODE='23505';
 END IF;
 IF p_action IN ('set-admin-role','revoke-admin-role') THEN
  IF p_target_telegram_id IS NULL OR p_target_telegram_id !~ '^[0-9]{1,20}$' THEN
   RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_ROLE',ERRCODE='22023';
  END IF;
  IF p_action='set-admin-role' THEN
   IF p_role IS NULL OR p_role NOT IN ('football','economy','moderator') THEN
    RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_ROLE',ERRCODE='22023';
   END IF;
   INSERT INTO public."AdminRoleAssignment"(id,"telegramId",role,active,"createdByTelegramId","updatedByTelegramId","createdAt","updatedAt")
   VALUES(gen_random_uuid()::text,p_target_telegram_id,p_role,true,p_actor_telegram_id,p_actor_telegram_id,clock_timestamp(),clock_timestamp())
   ON CONFLICT ("telegramId") DO UPDATE SET role=EXCLUDED.role,active=true,"updatedByTelegramId"=EXCLUDED."updatedByTelegramId","updatedAt"=clock_timestamp()
   RETURNING id INTO v_id;
  ELSE
   UPDATE public."AdminRoleAssignment" SET active=false,"updatedByTelegramId"=p_actor_telegram_id,"updatedAt"=clock_timestamp()
    WHERE "telegramId"=p_target_telegram_id RETURNING id INTO v_id;
   IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='ADMIN_ROLE_NOT_FOUND',ERRCODE='P0002'; END IF;
  END IF;
  v_metadata:=jsonb_build_object('telegramId',p_target_telegram_id,'role',p_role);
 ELSIF p_action='set-game-setting' THEN
  IF p_setting_key IS NULL OR p_setting_value IS NULL OR length(p_setting_key)>80
   OR p_setting_description IS NOT NULL AND length(p_setting_description)>300 THEN
   RAISE EXCEPTION USING MESSAGE='INVALID_SETTING',ERRCODE='22023';
  END IF;
  v_limits:=CASE p_setting_key
   WHEN 'groups.minimumMembers' THEN '{"min":5,"max":1000}'::jsonb
   WHEN 'groups.dailyActivityPoints' THEN '{"min":0,"max":1000}'::jsonb
   WHEN 'groups.dailyPointCap' THEN '{"min":0,"max":100000}'::jsonb
   WHEN 'groups.challengeJoinPoints' THEN '{"min":0,"max":1000}'::jsonb
   WHEN 'groups.challengeCreatePoints' THEN '{"min":0,"max":1000}'::jsonb
   WHEN 'groups.leagueJoinPoints' THEN '{"min":0,"max":1000}'::jsonb
   WHEN 'groups.leagueCreatePoints' THEN '{"min":0,"max":1000}'::jsonb
   WHEN 'groups.matchPlayedPoints' THEN '{"min":0,"max":1000}'::jsonb
   WHEN 'alliances.defaultSeasonDurationDays' THEN '{"min":7,"max":90}'::jsonb
   WHEN 'economy.starterCash' THEN '{"min":0,"max":1000000000}'::jsonb
   WHEN 'economy.starterGold' THEN '{"min":0,"max":1000000}'::jsonb
   ELSE NULL END;
  IF v_limits IS NULL OR jsonb_typeof(p_setting_value)<>'number' THEN
   RAISE EXCEPTION USING MESSAGE='INVALID_SETTING',ERRCODE='22023';
  END IF;
  v_value:=(p_setting_value #>> '{}')::numeric;
  v_min:=(v_limits->>'min')::numeric;v_max:=(v_limits->>'max')::numeric;
  IF v_value<>trunc(v_value) OR v_value<v_min OR v_value>v_max THEN
   RAISE EXCEPTION USING MESSAGE='INVALID_SETTING',ERRCODE='22023';
  END IF;
  INSERT INTO public."GameSetting"(id,key,value,description,"updatedByTelegramId","createdAt","updatedAt")
  VALUES(gen_random_uuid()::text,p_setting_key,p_setting_value,p_setting_description,p_actor_telegram_id,clock_timestamp(),clock_timestamp())
  ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,description=EXCLUDED.description,"updatedByTelegramId"=EXCLUDED."updatedByTelegramId","updatedAt"=clock_timestamp()
  RETURNING id INTO v_id;
  v_metadata:=jsonb_build_object('key',p_setting_key,'value',p_setting_value);
 END IF;
 INSERT INTO public."AdminAuditLog"(id,"actorTelegramId",action,"targetType","targetId",reason,metadata,"idempotencyKey")
 VALUES(gen_random_uuid()::text,p_actor_telegram_id,p_action,
  CASE WHEN p_action IN ('set-admin-role','revoke-admin-role') THEN 'admin-role' ELSE 'game-setting' END,
  COALESCE(p_target_telegram_id,p_setting_key),p_setting_description,v_metadata,p_idempotency_key);
 RETURN jsonb_build_object('ok',true,'targetType',CASE WHEN p_action IN ('set-admin-role','revoke-admin-role') THEN 'admin-role' ELSE 'game-setting' END,
  'targetId',COALESCE(p_target_telegram_id,p_setting_key),'recordId',v_id,'replay',false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_admin_configuration_http() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_configuration_action_http(text,text,text,text,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.get_admin_configuration_http() TO service_role;
  GRANT EXECUTE ON FUNCTION public.admin_configuration_action_http(text,text,text,text,text,text,jsonb,text) TO service_role;
 END IF;
END;
$grant$;
