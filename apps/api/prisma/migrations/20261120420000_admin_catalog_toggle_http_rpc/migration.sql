CREATE OR REPLACE FUNCTION public.admin_catalog_toggle_http(
 p_action text,p_target_id text,p_active boolean,p_actor_telegram_id text,p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE v_existing public."AdminAuditLog"%ROWTYPE; v_target_type text; v_count integer;
BEGIN
 IF p_action NOT IN ('toggle-item','toggle-gift-code')
  OR p_target_id IS NULL OR length(p_target_id) NOT BETWEEN 1 AND 128
  OR p_active IS NULL
  OR p_actor_telegram_id IS NULL OR p_actor_telegram_id !~ '^[0-9]{1,20}$'
  OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 12 AND 160 THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_CATALOG_ACTION',ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
 SELECT * INTO v_existing FROM public."AdminAuditLog" WHERE "idempotencyKey"=p_idempotency_key;
 IF FOUND THEN
  IF v_existing."actorTelegramId"=p_actor_telegram_id AND v_existing.action=p_action
   AND v_existing."targetId"=p_target_id AND v_existing.metadata->>'active'=p_active::text THEN
   RETURN jsonb_build_object('ok',true,'targetType',v_existing."targetType",'targetId',v_existing."targetId",'replay',true);
  END IF;
  RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_KEY_REUSED',ERRCODE='23505';
 END IF;
 IF p_action='toggle-item' THEN
  UPDATE public."GroupRewardItem" SET active=p_active WHERE id=p_target_id;
  v_target_type:='item';
 ELSE
  UPDATE public."GiftCode" SET active=p_active WHERE id=p_target_id;
  v_target_type:='gift-code';
 END IF;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN RAISE EXCEPTION USING MESSAGE='TARGET_NOT_FOUND',ERRCODE='P0002'; END IF;
 INSERT INTO public."AdminAuditLog"(id,"actorTelegramId",action,"targetType","targetId",reason,metadata,"idempotencyKey","createdAt")
 VALUES(gen_random_uuid()::text,p_actor_telegram_id,p_action,v_target_type,p_target_id,NULL,jsonb_build_object('active',p_active),p_idempotency_key,clock_timestamp());
 RETURN jsonb_build_object('ok',true,'targetType',v_target_type,'targetId',p_target_id,'replay',false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_catalog_toggle_http(text,text,boolean,text,text) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.admin_catalog_toggle_http(text,text,boolean,text,text) TO service_role;
 END IF;
END;
$grant$;
