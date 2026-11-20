CREATE OR REPLACE FUNCTION public.get_admin_broadcasts_http(p_limit integer DEFAULT 40)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE v_result jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_BROADCAST_LIMIT',ERRCODE='22023';
 END IF;
 WITH group_rows AS (
  SELECT b.id,'groups'::text kind,'ارسال گروهی به گروه‌ها'::text name,b."createdByTelegramId",
   b."createdAt",count(d.id)::integer total,
   count(d.id) FILTER(WHERE d."deliveredAt" IS NOT NULL AND d."deliveryLastError"<>'SKIPPED_GROUP_INACTIVE')::integer delivered,
   count(d.id) FILTER(WHERE d."deliveryLastError"='SKIPPED_GROUP_INACTIVE')::integer skipped,
   count(d.id) FILTER(WHERE d."deliveryAttempts">=8 AND d."deliveredAt" IS NULL)::integer failed,
   count(d.id) FILTER(WHERE d."deliveredAt" IS NULL AND d."deliveryAttempts"<8)::integer pending
  FROM (SELECT * FROM public."AdminGroupBroadcast" ORDER BY "createdAt" DESC LIMIT p_limit) b
  LEFT JOIN public."AdminGroupBroadcastDelivery" d ON d."broadcastId"=b.id
  GROUP BY b.id,b."createdByTelegramId",b."createdAt"
 ), user_audits AS (
  SELECT a."targetId",a."createdAt",a."actorTelegramId"
  FROM public."AdminAuditLog" a
  WHERE a.action='broadcast' AND a."targetType"='broadcast'
  ORDER BY a."createdAt" DESC LIMIT p_limit
 ), user_rows AS (
  SELECT a."targetId" id,'users'::text kind,'ارسال خصوصی به کاربران'::text name,
   a."actorTelegramId" "createdByTelegramId",a."createdAt",
   count(n.id)::integer total,
   count(n.id) FILTER(WHERE n."deliveredAt" IS NOT NULL OR n."readAt" IS NOT NULL)::integer delivered,
   0::integer skipped,
   count(n.id) FILTER(WHERE n."deliveredAt" IS NULL AND n."deliveryAttempts">=8)::integer failed,
   GREATEST(0,count(n.id)-count(n.id) FILTER(WHERE n."deliveredAt" IS NOT NULL OR n."readAt" IS NOT NULL)
    -count(n.id) FILTER(WHERE n."deliveredAt" IS NULL AND n."deliveryAttempts">=8))::integer pending
  FROM user_audits a
  LEFT JOIN public."LeagueNotice" n ON n."kind"='ADMIN_BROADCAST' AND n."referenceId"=a."targetId"
  GROUP BY a."targetId",a."createdAt",a."actorTelegramId"
 ), all_rows AS (
  SELECT * FROM group_rows UNION ALL SELECT * FROM user_rows
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id',id,'kind',kind,'name',name,'createdByTelegramId',"createdByTelegramId",
  'createdAt',"createdAt",'total',total,'delivered',delivered,'skipped',skipped,
  'failed',failed,'pending',pending) ORDER BY "createdAt" DESC,id),'[]'::jsonb)
 INTO v_result FROM (SELECT * FROM all_rows ORDER BY "createdAt" DESC LIMIT p_limit) rows;
 RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_admin_broadcasts_http(integer) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.get_admin_broadcasts_http(integer) TO service_role;
 END IF;
END;
$grant$;
