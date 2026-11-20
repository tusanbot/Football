CREATE OR REPLACE FUNCTION public.get_admin_ledger_entries_http(
 p_resource text,p_limit integer,p_query text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE v_result jsonb;
BEGIN
 IF p_resource IS NULL OR p_resource NOT IN ('wallet-ledger','group-ledger','audit')
  OR p_limit IS NULL OR p_limit<1 OR p_limit>100
  OR (p_query IS NOT NULL AND length(p_query)>100) THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_LEDGER_QUERY',ERRCODE='22023';
 END IF;
 IF p_resource='wallet-ledger' THEN
  SELECT COALESCE(jsonb_agg(q.row_data ORDER BY q.created_at DESC),'[]'::jsonb) INTO v_result
  FROM (
   SELECT jsonb_build_object(
    'id',l."id",'idempotencyKey',l."idempotencyKey",'userId',l."userId",
    'asset',l."asset"::text,'direction',l."direction"::text,'amount',l."amount"::text,
    'reason',l."reason",'referenceType',l."referenceType",'referenceId',l."referenceId",
    'createdAt',l."createdAt",
    'user',jsonb_build_object('telegramId',u."telegramId",'displayName',u."displayName",'username',u."username")
   ) AS row_data,l."createdAt" AS created_at
   FROM public."LedgerTransaction" l JOIN public."User" u ON u."id"=l."userId"
   WHERE p_query IS NULL OR u."telegramId" ILIKE '%'||p_query||'%'
    OR COALESCE(u."displayName",'') ILIKE '%'||p_query||'%'
    OR COALESCE(u."username",'') ILIKE '%'||p_query||'%'
    OR l."reason" ILIKE '%'||p_query||'%'
   ORDER BY l."createdAt" DESC LIMIT p_limit
  ) q;
 ELSIF p_resource='group-ledger' THEN
  SELECT COALESCE(jsonb_agg(q.row_data ORDER BY q.created_at DESC),'[]'::jsonb) INTO v_result
  FROM (
   SELECT jsonb_build_object(
    'id',l."id",'idempotencyKey',l."idempotencyKey",'groupId',l."groupId",'userId',l."userId",
    'amount',l."amount"::text,'source',l."source"::text,'description',l."description",
    'createdAt',l."createdAt",
    'group',jsonb_build_object('title',g.title,'telegramId',g."telegramId"),
    'user',CASE WHEN u."id" IS NULL THEN NULL ELSE jsonb_build_object(
      'telegramId',u."telegramId",'displayName',u."displayName") END
   ) AS row_data,l."createdAt" AS created_at
   FROM public."GroupPointLedger" l
   JOIN public."TelegramGroup" g ON g."id"=l."groupId"
   LEFT JOIN public."User" u ON u."id"=l."userId"
   WHERE p_query IS NULL OR g.title ILIKE '%'||p_query||'%'
    OR g."telegramId" ILIKE '%'||p_query||'%'
    OR COALESCE(u."telegramId",'') ILIKE '%'||p_query||'%'
    OR COALESCE(u."displayName",'') ILIKE '%'||p_query||'%'
    OR l."description" ILIKE '%'||p_query||'%'
   ORDER BY l."createdAt" DESC LIMIT p_limit
  ) q;
 ELSE
  SELECT COALESCE(jsonb_agg(q.row_data ORDER BY q.created_at DESC),'[]'::jsonb) INTO v_result
  FROM (
   SELECT to_jsonb(a) AS row_data,a."createdAt" AS created_at
   FROM public."AdminAuditLog" a
   WHERE p_query IS NULL OR a."actorTelegramId" ILIKE '%'||p_query||'%'
    OR a."action" ILIKE '%'||p_query||'%'
    OR a."targetType" ILIKE '%'||p_query||'%'
    OR a."targetId" ILIKE '%'||p_query||'%'
   ORDER BY a."createdAt" DESC LIMIT p_limit
  ) q;
 END IF;
 RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_admin_ledger_entries_http(text,integer,text) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.get_admin_ledger_entries_http(text,integer,text) TO service_role;
 END IF;
END;
$grant$;
