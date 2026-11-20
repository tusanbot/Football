CREATE OR REPLACE FUNCTION public.claim_due_admin_group_broadcasts_http(p_limit integer DEFAULT 20,p_lease_seconds integer DEFAULT 60)
RETURNS TABLE(id text,telegram_group_id text,message text,claim_token text,attempt integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE public."AdminGroupBroadcastDelivery" d SET "deliveredAt"=NOW(),"deliveryLastError"='SKIPPED_GROUP_INACTIVE',
  "deliveryClaimToken"=NULL,"deliveryLockedUntil"=NULL
 WHERE d."deliveredAt" IS NULL AND EXISTS(SELECT 1 FROM public."TelegramGroup" g
  WHERE g."telegramId"=d."telegramGroupId" AND (g."isActive"=false OR g."isSuspended"=true));
 RETURN QUERY
 WITH candidates AS (
  SELECT d."id" FROM public."AdminGroupBroadcastDelivery" d
  JOIN public."AdminGroupBroadcast" b ON b."id"=d."broadcastId"
  JOIN public."TelegramGroup" g ON g."telegramId"=d."telegramGroupId"
  WHERE g."isActive"=true AND g."isSuspended"=false AND d."deliveredAt" IS NULL
   AND d."deliveryAttempts"<8 AND d."availableAt"<=NOW()
   AND (d."deliveryLockedUntil" IS NULL OR d."deliveryLockedUntil"<=NOW())
  ORDER BY d."createdAt" FOR UPDATE OF d SKIP LOCKED
  LIMIT LEAST(GREATEST(COALESCE(p_limit,20),1),100)
 ), claimed AS (
  UPDATE public."AdminGroupBroadcastDelivery" d SET "deliveryClaimToken"=gen_random_uuid()::text,
   "deliveryLockedUntil"=NOW()+make_interval(secs=>LEAST(GREATEST(COALESCE(p_lease_seconds,60),5),300)),
   "deliveryAttempts"=d."deliveryAttempts"+1
  FROM candidates c WHERE d."id"=c."id" RETURNING d.*
 )
 SELECT c."id",c."telegramGroupId",b."message",c."deliveryClaimToken",c."deliveryAttempts"
 FROM claimed c JOIN public."AdminGroupBroadcast" b ON b."id"=c."broadcastId";
END; $$;
CREATE OR REPLACE FUNCTION public.complete_admin_group_broadcast_delivery_http(p_id text,p_claim_token text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE affected integer;
BEGIN
 UPDATE public."AdminGroupBroadcastDelivery" SET "deliveredAt"=NOW(),"deliveryClaimToken"=NULL,
  "deliveryLockedUntil"=NULL,"deliveryLastError"=NULL
 WHERE "id"=p_id AND "deliveryClaimToken"=p_claim_token AND "deliveredAt" IS NULL;
 GET DIAGNOSTICS affected=ROW_COUNT;RETURN affected=1;
END; $$;
CREATE OR REPLACE FUNCTION public.fail_admin_group_broadcast_delivery_http(p_id text,p_claim_token text,p_error text)
RETURNS TABLE(rescheduled boolean,attempts integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE current_attempts integer;affected integer;delay_seconds integer;
BEGIN
 SELECT d."deliveryAttempts" INTO current_attempts FROM public."AdminGroupBroadcastDelivery" d
 WHERE d."id"=p_id AND d."deliveryClaimToken"=p_claim_token AND d."deliveredAt" IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 delay_seconds:=LEAST(15*power(2,GREATEST(0,current_attempts-1))::integer,3600);
 UPDATE public."AdminGroupBroadcastDelivery" SET "deliveryClaimToken"=NULL,"deliveryLockedUntil"=NULL,
  "availableAt"=CASE WHEN current_attempts>=8 THEN TIMESTAMP '9999-12-31 00:00:00' ELSE NOW()+make_interval(secs=>delay_seconds) END,
  "deliveryLastError"=left(COALESCE(NULLIF(trim(p_error),''),'TELEGRAM_SEND_FAILED'),500)
 WHERE "id"=p_id AND "deliveryClaimToken"=p_claim_token AND "deliveredAt" IS NULL;
 GET DIAGNOSTICS affected=ROW_COUNT;IF affected<>1 THEN RETURN;END IF;
 RETURN QUERY SELECT current_attempts<8,current_attempts;
END; $$;
REVOKE ALL ON FUNCTION public.claim_due_admin_group_broadcasts_http(integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_admin_group_broadcast_delivery_http(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fail_admin_group_broadcast_delivery_http(text,text,text) FROM PUBLIC,anon,authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT EXECUTE ON FUNCTION public.claim_due_admin_group_broadcasts_http(integer,integer) TO service_role;
 GRANT EXECUTE ON FUNCTION public.complete_admin_group_broadcast_delivery_http(text,text) TO service_role;
 GRANT EXECUTE ON FUNCTION public.fail_admin_group_broadcast_delivery_http(text,text,text) TO service_role;
END IF; END $$;
