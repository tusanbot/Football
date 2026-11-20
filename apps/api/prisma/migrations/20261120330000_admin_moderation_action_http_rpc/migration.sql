CREATE OR REPLACE FUNCTION public.admin_moderation_action_http(
 p_action text,p_target_id text,p_actor_telegram_id text,p_idempotency_key text,p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE v_existing public."AdminAuditLog"%ROWTYPE; v_target_type text; v_count integer; v_challenge public."GroupChallenge"%ROWTYPE;
BEGIN
 IF p_action NOT IN ('suspend-user','restore-user','suspend-group','restore-group','cancel-challenge','league-status','competition-status')
  OR p_target_id IS NULL OR length(p_target_id) NOT BETWEEN 1 AND 128
  OR p_actor_telegram_id IS NULL OR p_actor_telegram_id !~ '^[0-9]{1,20}$'
  OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 12 AND 160
  OR (p_reason IS NOT NULL AND length(p_reason)>500) THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_ACTION',ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
 SELECT * INTO v_existing FROM public."AdminAuditLog" WHERE "idempotencyKey"=p_idempotency_key;
 IF FOUND THEN
  IF v_existing."actorTelegramId"=p_actor_telegram_id AND v_existing.action=p_action
   AND v_existing."targetId"=p_target_id THEN
   RETURN jsonb_build_object('ok',true,'targetType',v_existing."targetType",'targetId',v_existing."targetId",'replay',true);
  END IF;
  RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_KEY_REUSED',ERRCODE='23505';
 END IF;
 IF p_action IN ('suspend-user','restore-user') THEN
  UPDATE public."User" SET
   "isSuspended"=(p_action='suspend-user'),
   "suspendedAt"=CASE WHEN p_action='suspend-user' THEN clock_timestamp() ELSE NULL END,
   "suspensionReason"=CASE WHEN p_action='suspend-user' THEN COALESCE(p_reason,'Administrative action') ELSE NULL END,
   "updatedAt"=clock_timestamp()
   WHERE id=p_target_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN RAISE EXCEPTION USING MESSAGE='TARGET_NOT_FOUND',ERRCODE='P0002'; END IF;
  v_target_type:='user';
 ELSIF p_action IN ('suspend-group','restore-group') THEN
  UPDATE public."TelegramGroup" SET
   "isSuspended"=(p_action='suspend-group'),"isActive"=false,
   "suspendedAt"=CASE WHEN p_action='suspend-group' THEN clock_timestamp() ELSE NULL END,
   "suspensionReason"=CASE WHEN p_action='suspend-group' THEN COALESCE(p_reason,'Administrative action') ELSE NULL END
   WHERE id=p_target_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN RAISE EXCEPTION USING MESSAGE='TARGET_NOT_FOUND',ERRCODE='P0002'; END IF;
  v_target_type:='group';
 ELSIF p_action='cancel-challenge' THEN
  SELECT * INTO v_challenge FROM public."GroupChallenge" WHERE id=p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='TARGET_NOT_FOUND',ERRCODE='P0002'; END IF;
  IF v_challenge.status='OPEN' THEN
   UPDATE public."GroupChallenge" SET status='CANCELLED' WHERE id=p_target_id AND status='OPEN';
   IF v_challenge."rewardPoints">0 THEN
    UPDATE public."TelegramGroup" SET points=points+v_challenge."rewardPoints" WHERE id=v_challenge."groupId";
    INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt")
    VALUES(gen_random_uuid()::text,'challenge:'||p_target_id||':refund',v_challenge."groupId",NULL,v_challenge."rewardPoints",'CHALLENGE_REWARD','Admin cancellation refund',clock_timestamp())
    ON CONFLICT ("idempotencyKey") DO NOTHING;
   END IF;
  ELSIF v_challenge.status<>'CANCELLED' THEN
   RAISE EXCEPTION USING MESSAGE='CHALLENGE_ALREADY_SETTLED',ERRCODE='55000';
  END IF;
  v_target_type:='challenge';
 ELSE
  IF EXISTS(SELECT 1 FROM public."PyramidLeague" WHERE "competitionId"=p_target_id) THEN
   RAISE EXCEPTION USING MESSAGE='PYRAMID_LEAGUE_STATUS_MANAGED_AUTOMATICALLY',ERRCODE='55000';
  END IF;
  UPDATE public."Competition" SET status='CANCELLED',"updatedAt"=clock_timestamp() WHERE id=p_target_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN RAISE EXCEPTION USING MESSAGE='TARGET_NOT_FOUND',ERRCODE='P0002'; END IF;
  v_target_type:='competition';
 END IF;
 INSERT INTO public."AdminAuditLog"(id,"actorTelegramId",action,"targetType","targetId",reason,metadata,"idempotencyKey","createdAt")
 VALUES(gen_random_uuid()::text,p_actor_telegram_id,p_action,v_target_type,p_target_id,p_reason,'{}'::jsonb,p_idempotency_key,clock_timestamp());
 RETURN jsonb_build_object('ok',true,'targetType',v_target_type,'targetId',p_target_id,'replay',false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_moderation_action_http(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.admin_moderation_action_http(text,text,text,text,text) TO service_role;
 END IF;
END;
$grant$;
