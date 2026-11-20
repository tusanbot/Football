-- Read-only role assignment lookup for event-tournament administration.
CREATE OR REPLACE FUNCTION public.get_event_tournament_admin_role_http(p_telegram_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp
AS $fn$
DECLARE v_result jsonb;
BEGIN
 IF p_telegram_id IS NULL OR p_telegram_id !~ '^[0-9]{1,20}$' THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_TELEGRAM_ID',ERRCODE='22023';
 END IF;
 SELECT jsonb_build_object('role',role,'active',active) INTO v_result
 FROM public."AdminRoleAssignment" WHERE "telegramId"=p_telegram_id;
 RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_event_tournament_admin_role_http(text) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.get_event_tournament_admin_role_http(text) TO service_role;
 END IF;
END;
$grant$;
