CREATE OR REPLACE FUNCTION public.list_pyramid_league_notices_http(p_user_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_notices jsonb;
BEGIN
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',n.id,'kind',n.kind,'title',n.title,'body',n.body,
  'referenceId',n."referenceId",'createdAt',n."createdAt") ORDER BY n."createdAt" DESC),'[]'::jsonb)
 INTO v_notices FROM public."LeagueNotice" n
 WHERE n."userId"=p_user_id AND n."readAt" IS NULL;
 RETURN jsonb_build_object('notices',v_notices);
END;$fn$;

CREATE OR REPLACE FUNCTION public.mark_pyramid_league_notices_read_http(p_user_id text,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN
 UPDATE public."LeagueNotice" SET "readAt"=p_now
 WHERE "userId"=p_user_id AND "readAt" IS NULL;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN jsonb_build_object('markedRead',v_count);
END;$fn$;

CREATE OR REPLACE FUNCTION public.claim_pyramid_league_notices_http(p_limit integer,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_notices jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR p_now IS NULL THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_LEAGUE_NOTICE_CLAIM',ERRCODE='P0001';
 END IF;
 WITH due AS (
  SELECT n.id FROM public."LeagueNotice" n
  WHERE n."deliveredAt" IS NULL AND n."readAt" IS NULL AND n."deliveryAttempts"<8
   AND (n."deliveryLockedUntil" IS NULL OR n."deliveryLockedUntil"<=p_now)
  ORDER BY n."createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT p_limit
 ), claimed AS (
  UPDATE public."LeagueNotice" n SET
   "deliveryClaimToken"=gen_random_uuid()::text,
   "deliveryLockedUntil"=p_now+interval '60 seconds',
   "deliveryAttempts"=n."deliveryAttempts"+1
  FROM due WHERE n.id=due.id
  RETURNING n.id,n."userId",n.title,n.body,n.kind,n."referenceId",n."deliveryClaimToken"
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id',c.id,'telegramId',u."telegramId",'title',c.title,'body',c.body,'kind',c.kind,
  'referenceId',c."referenceId",'claimToken',c."deliveryClaimToken"
 )),'[]'::jsonb) INTO v_notices
 FROM claimed c JOIN public."User" u ON u.id=c."userId";
 RETURN jsonb_build_object('notices',v_notices);
END;$fn$;

CREATE OR REPLACE FUNCTION public.complete_pyramid_league_notice_http(p_id text,p_claim_token text,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN
 UPDATE public."LeagueNotice" SET "deliveredAt"=p_now,"deliveryClaimToken"=NULL,
  "deliveryLockedUntil"=NULL,"deliveryLastError"=NULL
 WHERE id=p_id AND "deliveryClaimToken"=p_claim_token AND "deliveredAt" IS NULL;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN jsonb_build_object('completed',v_count=1);
END;$fn$;

CREATE OR REPLACE FUNCTION public.fail_pyramid_league_notice_http(p_id text,p_claim_token text,p_error text,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE v_attempts integer; v_count integer; v_delay integer;
BEGIN
 IF COALESCE(length(btrim(p_error)),0)=0 OR length(p_error)>500 THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_LEAGUE_NOTICE_FAILURE',ERRCODE='P0001';
 END IF;
 SELECT "deliveryAttempts" INTO v_attempts FROM public."LeagueNotice"
 WHERE id=p_id AND "deliveryClaimToken"=p_claim_token AND "deliveredAt" IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('owned',false); END IF;
 v_delay:=LEAST(15000::numeric*power(2,GREATEST(0,v_attempts-1)),3600000)::integer;
 UPDATE public."LeagueNotice" SET "deliveryClaimToken"=NULL,
  "deliveryLockedUntil"=CASE WHEN v_attempts>=8 THEN '9999-12-31T00:00:00Z'::timestamptz ELSE p_now+(v_delay::text||' milliseconds')::interval END,
  "deliveryLastError"=p_error
 WHERE id=p_id AND "deliveryClaimToken"=p_claim_token AND "deliveredAt" IS NULL;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN jsonb_build_object('owned',v_count=1,'rescheduled',v_attempts<8,'attempts',v_attempts);
END;$fn$;

REVOKE ALL ON FUNCTION public.list_pyramid_league_notices_http(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mark_pyramid_league_notices_read_http(text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_pyramid_league_notices_http(integer,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_pyramid_league_notice_http(text,text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fail_pyramid_league_notice_http(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.list_pyramid_league_notices_http(text) TO service_role;
  GRANT EXECUTE ON FUNCTION public.mark_pyramid_league_notices_read_http(text,timestamptz) TO service_role;
  GRANT EXECUTE ON FUNCTION public.claim_pyramid_league_notices_http(integer,timestamptz) TO service_role;
  GRANT EXECUTE ON FUNCTION public.complete_pyramid_league_notice_http(text,text,timestamptz) TO service_role;
  GRANT EXECUTE ON FUNCTION public.fail_pyramid_league_notice_http(text,text,text,timestamptz) TO service_role;
 END IF;
END;$grant$;
