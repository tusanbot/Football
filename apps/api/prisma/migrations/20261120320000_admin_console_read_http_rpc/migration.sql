CREATE OR REPLACE FUNCTION public.get_admin_console_read_http(p_view text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE v_result jsonb;
BEGIN
 IF p_view NOT IN ('overview','group-targets') THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_CONSOLE_VIEW',ERRCODE='22023';
 END IF;
 IF p_view='overview' THEN
  SELECT jsonb_build_object('counts',jsonb_build_object(
   'users',(SELECT count(*) FROM public."User"),
   'clubs',(SELECT count(*) FROM public."Club"),
   'players',(SELECT count(*) FROM public."Player"),
   'groups',(SELECT count(*) FROM public."TelegramGroup"),
   'challenges',(SELECT count(*) FROM public."GroupChallenge"),
   'leagues',(SELECT count(*) FROM public."Competition"),
   'items',(SELECT count(*) FROM public."GroupRewardItem"),
   'giftCodes',(SELECT count(*) FROM public."GiftCode"),
   'flags',(SELECT count(*) FROM public."AllianceSeason" WHERE "reviewStatus"='FLAGGED'),
   'alliances',(SELECT count(*) FROM public."Alliance"),
   'matches',(SELECT count(*) FROM public."FootballMatch"),
   'walletTransactions',(SELECT count(*) FROM public."LedgerTransaction"),
   'groupTransactions',(SELECT count(*) FROM public."GroupPointLedger")
  )) INTO v_result;
 ELSE
  SELECT jsonb_build_object('groups',COALESCE(jsonb_agg(jsonb_build_object('telegramId',g."telegramId",'title',g.title) ORDER BY g."createdAt" ASC),'[]'::jsonb))
   INTO v_result
   FROM (SELECT "telegramId",title,"createdAt" FROM public."TelegramGroup"
         WHERE "isActive"=true AND "isSuspended"=false
         ORDER BY "createdAt" ASC LIMIT 5000) g;
 END IF;
 RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_admin_console_read_http(text) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.get_admin_console_read_http(text) TO service_role;
 END IF;
END;
$grant$;
