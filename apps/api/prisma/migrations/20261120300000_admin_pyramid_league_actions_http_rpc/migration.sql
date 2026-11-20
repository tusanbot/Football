CREATE OR REPLACE FUNCTION public.admin_pyramid_league_action_http(
 p_action text,p_target_id text,p_actor_telegram_id text,p_idempotency_key text,
 p_reason text DEFAULT NULL,p_status text DEFAULT NULL,p_hours integer DEFAULT NULL,
 p_award_name text DEFAULT NULL,p_award_type text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE
 v_existing public."AdminAuditLog"%ROWTYPE;
 v_target_type text;
 v_target_id text:=p_target_id;
 v_expires_at timestamptz;
 v_award_id text;
 v_action_name text;
 v_metadata jsonb;
BEGIN
 IF p_action NOT IN ('league-status','withdraw-application','extend-promotion-deadline','update-award')
  OR p_target_id IS NULL OR length(p_target_id)<1 OR length(p_target_id)>128
  OR p_actor_telegram_id IS NULL OR p_actor_telegram_id !~ '^[0-9]{1,20}$'
  OR p_idempotency_key IS NULL OR length(p_idempotency_key)<12 OR length(p_idempotency_key)>160
  OR p_reason IS NOT NULL AND length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_ACTION',ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
 SELECT * INTO v_existing FROM public."AdminAuditLog" WHERE "idempotencyKey"=p_idempotency_key;
 v_action_name:='pyramid-'||p_action;
 IF FOUND THEN
  IF v_existing."actorTelegramId"=p_actor_telegram_id AND v_existing.action=v_action_name AND v_existing."targetId"=p_target_id THEN
   RETURN jsonb_build_object('ok',true,'targetType',v_existing."targetType",'targetId',v_existing."targetId",'replay',true);
  END IF;
  RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_KEY_REUSED',ERRCODE='23505';
 END IF;

 IF p_action='league-status' THEN
  IF p_status IS DISTINCT FROM 'CANCELLED' THEN
   RAISE EXCEPTION USING MESSAGE='STATUS_REQUIRED',ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public."PyramidLeague" WHERE id=p_target_id) THEN
   RAISE EXCEPTION USING MESSAGE='TARGET_NOT_FOUND',ERRCODE='P0002';
  END IF;
  IF EXISTS(SELECT 1 FROM public."PyramidLeague" l JOIN public."Competition" c ON c.id=l."competitionId" WHERE l.id=p_target_id AND c.status='COMPLETED') THEN
   RAISE EXCEPTION USING MESSAGE='COMPLETED_LEAGUE_LOCKED',ERRCODE='55000';
  END IF;
  RAISE EXCEPTION USING MESSAGE='PYRAMID_LEAGUE_STATUS_MANAGED_AUTOMATICALLY',ERRCODE='55000';
 ELSIF p_action='withdraw-application' THEN
  UPDATE public."PyramidLeagueApplication" SET status='WITHDRAWN'
   WHERE id=p_target_id AND status='QUEUED';
  IF NOT FOUND THEN
   IF EXISTS(SELECT 1 FROM public."PyramidLeagueApplication" WHERE id=p_target_id) THEN
    RAISE EXCEPTION USING MESSAGE='QUEUED_APPLICATION_NOT_FOUND',ERRCODE='55000';
   END IF;
   RAISE EXCEPTION USING MESSAGE='TARGET_NOT_FOUND',ERRCODE='P0002';
  END IF;
  v_target_type:='league-application';
 ELSIF p_action='extend-promotion-deadline' THEN
  IF p_hours IS NULL OR p_hours<1 OR p_hours>72 THEN
   RAISE EXCEPTION USING MESSAGE='HOURS_REQUIRED',ERRCODE='22023';
  END IF;
  UPDATE public."LeaguePromotionOffer"
   SET "expiresAt"=GREATEST("expiresAt",clock_timestamp())+make_interval(hours=>p_hours)
   WHERE id=p_target_id AND status='PENDING'
   RETURNING "expiresAt" INTO v_expires_at;
  IF NOT FOUND THEN
   IF EXISTS(SELECT 1 FROM public."LeaguePromotionOffer" WHERE id=p_target_id) THEN
    RAISE EXCEPTION USING MESSAGE='PENDING_OFFER_NOT_FOUND',ERRCODE='55000';
   END IF;
   RAISE EXCEPTION USING MESSAGE='TARGET_NOT_FOUND',ERRCODE='P0002';
  END IF;
  v_target_type:='promotion-offer';
 ELSIF p_action='update-award' THEN
  IF (p_award_name IS NULL OR length(btrim(p_award_name)) NOT BETWEEN 2 AND 80)
   AND (p_award_type IS NULL OR length(btrim(p_award_type)) NOT BETWEEN 2 AND 40) THEN
   RAISE EXCEPTION USING MESSAGE='AWARD_FIELDS_REQUIRED',ERRCODE='22023';
  END IF;
  UPDATE public."LeagueAward" SET
   "awardName"=COALESCE(NULLIF(btrim(p_award_name),''),"awardName"),
   "awardType"=COALESCE(NULLIF(btrim(p_award_type),''),"awardType")
   WHERE id=p_target_id RETURNING id INTO v_award_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='TARGET_NOT_FOUND',ERRCODE='P0002'; END IF;
  v_target_type:='league-award';
 ELSE
  RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_ACTION',ERRCODE='22023';
 END IF;

 v_metadata:=jsonb_build_object('status',p_status,'hours',p_hours,'awardName',p_award_name,'awardType',p_award_type);
 INSERT INTO public."AdminAuditLog"(id,"actorTelegramId",action,"targetType","targetId",reason,metadata,"idempotencyKey")
 VALUES(gen_random_uuid()::text,p_actor_telegram_id,v_action_name,v_target_type,v_target_id,p_reason,v_metadata,p_idempotency_key);
 RETURN jsonb_build_object('ok',true,'targetType',v_target_type,'targetId',v_target_id,'replay',false,
  'expiresAt',CASE WHEN v_expires_at IS NULL THEN NULL ELSE to_jsonb(v_expires_at) END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_pyramid_league_action_http(text,text,text,text,text,text,integer,text,text) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.admin_pyramid_league_action_http(text,text,text,text,text,text,integer,text,text) TO service_role;
 END IF;
END;
$grant$;
