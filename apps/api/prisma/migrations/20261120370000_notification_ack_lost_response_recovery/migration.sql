ALTER TABLE public."AdminGroupBroadcastDelivery"
 ADD COLUMN IF NOT EXISTS "deliveryCompletedClaimToken" text;
ALTER TABLE public."MatchLifecycleNotification"
 ADD COLUMN IF NOT EXISTS "completedClaimToken" text;
ALTER TABLE public."MatchResultNotification"
 ADD COLUMN IF NOT EXISTS "completedClaimToken" text;
ALTER TABLE public."TelegramMessageDeletion"
 ADD COLUMN IF NOT EXISTS "completedClaimToken" text;

CREATE OR REPLACE FUNCTION public.complete_admin_group_broadcast_delivery_http(p_id text,p_claim_token text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE affected integer;
BEGIN
 UPDATE public."AdminGroupBroadcastDelivery" SET "deliveredAt"=NOW(),"deliveryClaimToken"=NULL,
  "deliveryLockedUntil"=NULL,"deliveryLastError"=NULL,"deliveryCompletedClaimToken"=p_claim_token
 WHERE "id"=p_id AND "deliveryClaimToken"=p_claim_token AND "deliveredAt" IS NULL;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected=1 THEN RETURN true; END IF;
 RETURN EXISTS(SELECT 1 FROM public."AdminGroupBroadcastDelivery"
  WHERE "id"=p_id AND "deliveredAt" IS NOT NULL AND "deliveryCompletedClaimToken"=p_claim_token);
END; $$;

CREATE OR REPLACE FUNCTION public.complete_match_notification_delivery(p_notification_type text,p_notification_id text,p_claim_token text,
 p_delivered boolean,p_error text DEFAULT NULL,p_retry_seconds integer DEFAULT 15)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE affected integer;
BEGIN
 IF p_notification_type='LIFECYCLE' THEN
  UPDATE public."MatchLifecycleNotification" SET
   "status"=CASE WHEN p_delivered THEN 'DELIVERED' ELSE 'PENDING' END,
   "deliveredAt"=CASE WHEN p_delivered THEN NOW() ELSE NULL END,
   "availableAt"=CASE WHEN p_delivered THEN "availableAt" ELSE NOW()+make_interval(secs=>LEAST(GREATEST(p_retry_seconds,1),3600)) END,
   "claimToken"=NULL,"lockedUntil"=NULL,
   "lastError"=CASE WHEN p_delivered THEN NULL ELSE left(COALESCE(p_error,'TELEGRAM_SEND_FAILED'),500) END,
   "completedClaimToken"=CASE WHEN p_delivered THEN p_claim_token ELSE NULL END,
   "updatedAt"=NOW()
  WHERE "id"=p_notification_id AND "claimToken"=p_claim_token AND "status"='PENDING';
 ELSIF p_notification_type='RESULT' THEN
  UPDATE public."MatchResultNotification" SET
   "status"=CASE WHEN p_delivered THEN 'DELIVERED' ELSE 'PENDING' END,
   "deliveredAt"=CASE WHEN p_delivered THEN NOW() ELSE NULL END,
   "availableAt"=CASE WHEN p_delivered THEN "availableAt" ELSE NOW()+make_interval(secs=>LEAST(GREATEST(p_retry_seconds,1),3600)) END,
   "claimToken"=NULL,"lockedUntil"=NULL,
   "lastError"=CASE WHEN p_delivered THEN NULL ELSE left(COALESCE(p_error,'TELEGRAM_SEND_FAILED'),500) END,
   "completedClaimToken"=CASE WHEN p_delivered THEN p_claim_token ELSE NULL END,
   "updatedAt"=NOW()
  WHERE "id"=p_notification_id AND "claimToken"=p_claim_token AND "status"='PENDING';
 ELSE RAISE EXCEPTION 'INVALID_MATCH_NOTIFICATION_TYPE';
 END IF;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected=1 THEN RETURN true; END IF;
 IF NOT p_delivered THEN RETURN false; END IF;
 IF p_notification_type='LIFECYCLE' THEN
  RETURN EXISTS(SELECT 1 FROM public."MatchLifecycleNotification"
   WHERE "id"=p_notification_id AND "status"='DELIVERED' AND "completedClaimToken"=p_claim_token);
 END IF;
 RETURN EXISTS(SELECT 1 FROM public."MatchResultNotification"
  WHERE "id"=p_notification_id AND "status"='DELIVERED' AND "completedClaimToken"=p_claim_token);
END; $$;

CREATE OR REPLACE FUNCTION public.complete_telegram_message_deletion_http(p_id text,p_claim_token text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE affected integer;
BEGIN
 UPDATE public."TelegramMessageDeletion" SET "status"='DELETED',"deletedAt"=NOW(),"lockedUntil"=NULL,
  "claimToken"=NULL,"lastError"=NULL,"completedClaimToken"=p_claim_token,"updatedAt"=NOW()
 WHERE "id"=p_id AND "status"='PROCESSING' AND "claimToken"=p_claim_token;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected=1 THEN RETURN true; END IF;
 RETURN EXISTS(SELECT 1 FROM public."TelegramMessageDeletion"
  WHERE "id"=p_id AND "status"='DELETED' AND "completedClaimToken"=p_claim_token);
END; $$;

REVOKE ALL ON FUNCTION public.complete_admin_group_broadcast_delivery_http(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_match_notification_delivery(text,text,text,boolean,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_telegram_message_deletion_http(text,text) FROM PUBLIC,anon,authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT EXECUTE ON FUNCTION public.complete_admin_group_broadcast_delivery_http(text,text) TO service_role;
 GRANT EXECUTE ON FUNCTION public.complete_match_notification_delivery(text,text,text,boolean,text,integer) TO service_role;
 GRANT EXECUTE ON FUNCTION public.complete_telegram_message_deletion_http(text,text) TO service_role;
END IF; END $$;
