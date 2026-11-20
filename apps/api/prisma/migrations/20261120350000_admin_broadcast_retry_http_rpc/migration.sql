CREATE OR REPLACE FUNCTION public.admin_broadcast_retry_http(
 p_kind text,p_target_id text,p_actor_telegram_id text,p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE v_action text; v_target_type text; v_existing public."AdminAuditLog"%ROWTYPE; v_count integer;
BEGIN
 IF p_kind NOT IN ('groups','users') OR p_target_id IS NULL OR length(p_target_id) NOT BETWEEN 1 AND 128
  OR p_actor_telegram_id IS NULL OR p_actor_telegram_id !~ '^[0-9]{1,20}$'
  OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 12 AND 160 THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_BROADCAST_RETRY',ERRCODE='22023';
 END IF;
 v_action:=CASE WHEN p_kind='groups' THEN 'retry-group-broadcast' ELSE 'retry-user-broadcast' END;
 v_target_type:=CASE WHEN p_kind='groups' THEN 'group-broadcast' ELSE 'user-broadcast' END;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
 SELECT * INTO v_existing FROM public."AdminAuditLog" WHERE "idempotencyKey"=p_idempotency_key;
 IF FOUND THEN
  IF v_existing."actorTelegramId"=p_actor_telegram_id AND v_existing.action=v_action AND v_existing."targetId"=p_target_id THEN
   RETURN jsonb_build_object('ok',true,'retried',COALESCE((v_existing.metadata->>'retried')::integer,0),'replayed',true);
  END IF;
  RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_KEY_REUSED',ERRCODE='23505';
 END IF;
 IF p_kind='groups' THEN
  UPDATE public."AdminGroupBroadcastDelivery" SET "deliveryAttempts"=0,"availableAt"=clock_timestamp(),
   "deliveryClaimToken"=NULL,"deliveryLockedUntil"=NULL,"deliveryLastError"=NULL
   WHERE "broadcastId"=p_target_id AND "deliveredAt" IS NULL AND "deliveryAttempts">=8;
 ELSE
  UPDATE public."LeagueNotice" SET "deliveryAttempts"=0,"deliveryClaimToken"=NULL,
   "deliveryLockedUntil"=NULL,"deliveryLastError"=NULL
   WHERE "referenceId"=p_target_id AND kind='ADMIN_BROADCAST' AND "deliveredAt" IS NULL
    AND "readAt" IS NULL AND "deliveryAttempts">=8;
 END IF;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count=0 THEN RAISE EXCEPTION USING MESSAGE='NO_FAILED_DELIVERIES',ERRCODE='55000'; END IF;
 INSERT INTO public."AdminAuditLog"(id,"actorTelegramId",action,"targetType","targetId",metadata,"idempotencyKey","createdAt")
 VALUES(gen_random_uuid()::text,p_actor_telegram_id,v_action,v_target_type,p_target_id,
  jsonb_build_object('retried',v_count),p_idempotency_key,clock_timestamp());
 RETURN jsonb_build_object('ok',true,'retried',v_count,'replayed',false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_broadcast_retry_http(text,text,text,text) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.admin_broadcast_retry_http(text,text,text,text) TO service_role;
 END IF;
END;
$grant$;
