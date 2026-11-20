CREATE OR REPLACE FUNCTION public.admin_season_player_award_http(
 p_action text,p_target_id text,p_season integer,p_player_id text,p_award_type text,p_award_name text,
 p_reason text,p_actor_telegram_id text,p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE
 v_existing public."AdminAuditLog"%ROWTYPE;
 v_award_id text;
 v_metadata jsonb;
 v_audit_key text;
BEGIN
 IF p_action NOT IN ('set-season-player-award','remove-season-player-award')
  OR p_actor_telegram_id IS NULL OR p_actor_telegram_id !~ '^[0-9]{1,20}$'
  OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{12,128}$'
  OR (p_reason IS NOT NULL AND length(p_reason)>500) THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_SEASON_AWARD_ACTION',ERRCODE='22023';
 END IF;
 IF p_action='set-season-player-award' AND (
  p_season IS NULL OR p_season NOT BETWEEN 2020 AND 2200
  OR p_player_id IS NULL OR length(p_player_id) NOT BETWEEN 1 AND 128
  OR p_award_type IS NULL OR p_award_type NOT IN ('TOP_SCORER','TOP_ASSISTS','PLAYER_OF_SEASON','TEAM_OF_SEASON','FAIR_PLAY','MOST_IMPROVED')
  OR p_award_name IS NULL OR length(btrim(p_award_name)) NOT BETWEEN 2 AND 80
  OR p_target_id IS NOT NULL
 ) THEN RAISE EXCEPTION USING MESSAGE='INVALID_SEASON_AWARD_ACTION',ERRCODE='22023'; END IF;
 IF p_action='remove-season-player-award' AND (
  p_target_id IS NULL OR length(p_target_id) NOT BETWEEN 1 AND 128
  OR p_season IS NOT NULL OR p_player_id IS NOT NULL OR p_award_type IS NOT NULL OR p_award_name IS NOT NULL
 ) THEN RAISE EXCEPTION USING MESSAGE='INVALID_SEASON_AWARD_ACTION',ERRCODE='22023'; END IF;
 v_audit_key:='admin-season-award:'||p_idempotency_key;
 v_metadata:=jsonb_build_object('action',p_action,'season',p_season,'playerId',p_player_id,
  'awardType',p_award_type,'awardName',p_award_name,'reason',p_reason,'targetId',p_target_id);
 PERFORM pg_advisory_xact_lock(hashtextextended(v_audit_key,0));
 SELECT * INTO v_existing FROM public."AdminAuditLog" WHERE "idempotencyKey"=v_audit_key;
 IF FOUND THEN
  IF v_existing."actorTelegramId"=p_actor_telegram_id AND v_existing.action=p_action
   AND v_existing."targetType"='season-player-award' AND v_existing.metadata=v_metadata THEN
   RETURN jsonb_build_object('ok',true,'targetType','season-player-award','targetId',v_existing."targetId",'replay',true);
  END IF;
  RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_KEY_REUSED',ERRCODE='23505';
 END IF;
 IF p_action='set-season-player-award' THEN
  INSERT INTO public."SeasonPlayerAward"(id,season,"playerId","awardType","awardName",reason,"createdByTelegramId","updatedByTelegramId","createdAt","updatedAt")
  VALUES(gen_random_uuid()::text,p_season,p_player_id,p_award_type,btrim(p_award_name),p_reason,p_actor_telegram_id,p_actor_telegram_id,clock_timestamp(),clock_timestamp())
  ON CONFLICT(season,"playerId","awardType") DO UPDATE SET
   "awardName"=EXCLUDED."awardName",reason=EXCLUDED.reason,"updatedByTelegramId"=EXCLUDED."updatedByTelegramId","updatedAt"=clock_timestamp()
  RETURNING id INTO v_award_id;
 ELSE
  DELETE FROM public."SeasonPlayerAward" WHERE id=p_target_id RETURNING id INTO v_award_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='TARGET_NOT_FOUND',ERRCODE='P0002'; END IF;
 END IF;
 INSERT INTO public."AdminAuditLog"(id,"actorTelegramId",action,"targetType","targetId",reason,metadata,"idempotencyKey","createdAt")
 VALUES(gen_random_uuid()::text,p_actor_telegram_id,p_action,'season-player-award',v_award_id,p_reason,v_metadata,v_audit_key,clock_timestamp());
 RETURN jsonb_build_object('ok',true,'targetType','season-player-award','targetId',v_award_id,'replay',false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_broadcast_create_http(
 p_kind text,p_message text,p_actor_telegram_id text,p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE
 v_existing public."AdminAuditLog"%ROWTYPE;
 v_audit_key text;
 v_target_id text;
 v_metadata jsonb;
 v_count integer;
 v_group_count integer;
BEGIN
 IF p_kind NOT IN ('users','groups') OR p_message IS NULL OR length(btrim(p_message)) NOT BETWEEN 2 AND 3000
  OR p_actor_telegram_id IS NULL OR p_actor_telegram_id !~ '^[0-9]{1,20}$'
  OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{12,128}$' THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_BROADCAST',ERRCODE='22023';
 END IF;
 v_audit_key:='admin-broadcast-create:'||p_kind||':'||p_idempotency_key;
 v_metadata:=jsonb_build_object('kind',p_kind,'message',btrim(p_message));
 PERFORM pg_advisory_xact_lock(hashtextextended(v_audit_key,0));
 SELECT * INTO v_existing FROM public."AdminAuditLog" WHERE "idempotencyKey"=v_audit_key;
 IF FOUND THEN
  IF v_existing."actorTelegramId"=p_actor_telegram_id AND v_existing.action='broadcast-'||p_kind
   AND v_existing.metadata=v_metadata THEN
   RETURN jsonb_build_object('ok',true,'kind',p_kind,'targetId',v_existing."targetId",'recipients',COALESCE((v_existing.metadata->>'recipients')::integer,0),'replay',true);
  END IF;
  RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_KEY_REUSED',ERRCODE='23505';
 END IF;
 IF p_kind='users' THEN
  v_target_id:='user-broadcast:'||p_idempotency_key;
  INSERT INTO public."LeagueNotice"(id,"userId",kind,title,body,"referenceId","dedupeKey","createdAt")
  SELECT gen_random_uuid()::text,u.id,'ADMIN_BROADCAST','پیام مدیریت Football Empire',btrim(p_message),v_target_id,
   'admin-broadcast:'||p_idempotency_key||':'||u.id,clock_timestamp()
  FROM public."User" u WHERE u."isSuspended"=false;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count=0 THEN RAISE EXCEPTION USING MESSAGE='NO_BROADCAST_RECIPIENTS',ERRCODE='P0001'; END IF;
  v_metadata:=v_metadata||jsonb_build_object('recipients',v_count);
  INSERT INTO public."AdminAuditLog"(id,"actorTelegramId",action,"targetType","targetId",metadata,"idempotencyKey","createdAt")
  VALUES(gen_random_uuid()::text,p_actor_telegram_id,'broadcast-users','broadcast',v_target_id,v_metadata,v_audit_key,clock_timestamp());
 ELSE
  v_target_id:=gen_random_uuid()::text;
  INSERT INTO public."AdminGroupBroadcast"(id,"idempotencyKey",message,"createdByTelegramId","createdAt")
  VALUES(v_target_id,'admin-group-broadcast:'||p_idempotency_key,btrim(p_message),p_actor_telegram_id,clock_timestamp());
  INSERT INTO public."AdminGroupBroadcastDelivery"(id,"broadcastId","telegramGroupId","groupTitle","createdAt")
  SELECT gen_random_uuid()::text,v_target_id,g."telegramId",g.title,clock_timestamp()
  FROM public."TelegramGroup" g WHERE g."isActive"=true AND g."isSuspended"=false;
  GET DIAGNOSTICS v_group_count=ROW_COUNT;
  IF v_group_count=0 THEN RAISE EXCEPTION USING MESSAGE='NO_BROADCAST_RECIPIENTS',ERRCODE='P0001'; END IF;
  v_count:=v_group_count;
  v_metadata:=v_metadata||jsonb_build_object('recipients',v_count);
  INSERT INTO public."AdminAuditLog"(id,"actorTelegramId",action,"targetType","targetId",metadata,"idempotencyKey","createdAt")
  VALUES(gen_random_uuid()::text,p_actor_telegram_id,'broadcast-groups','group-broadcast',v_target_id,v_metadata,v_audit_key,clock_timestamp());
 END IF;
 RETURN jsonb_build_object('ok',true,'kind',p_kind,'targetId',v_target_id,'recipients',v_count,'replay',false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_season_player_award_http(text,text,integer,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_broadcast_create_http(text,text,text,text) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.admin_season_player_award_http(text,text,integer,text,text,text,text,text) TO service_role;
  GRANT EXECUTE ON FUNCTION public.admin_broadcast_create_http(text,text,text,text) TO service_role;
 END IF;
END;
$grant$;
