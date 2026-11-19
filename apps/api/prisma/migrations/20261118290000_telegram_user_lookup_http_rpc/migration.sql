-- Resolve Telegram identities and throttle last-active writes inside Supabase.
CREATE OR REPLACE FUNCTION public.resolve_telegram_user(p_telegram_id text, p_now timestamptz DEFAULT NOW())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  user_row public."User"%ROWTYPE;
BEGIN
  IF p_telegram_id IS NULL OR p_telegram_id !~ '^[0-9]{1,20}$' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_TELEGRAM_ID', ERRCODE = 'P0001';
  END IF;
  UPDATE public."User" AS target
  SET "lastActiveAt" = p_now
  WHERE target."telegramId" = p_telegram_id
    AND target."isSuspended" = FALSE
    AND (target."lastActiveAt" IS NULL OR target."lastActiveAt" < p_now - INTERVAL '60 seconds')
  RETURNING target.* INTO user_row;
  IF NOT FOUND THEN
    SELECT * INTO user_row FROM public."User"
    WHERE "telegramId" = p_telegram_id AND "isSuspended" = FALSE;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', user_row.id, 'telegramId', user_row."telegramId", 'username', user_row.username,
    'displayName', user_row."displayName", 'createdAt', user_row."createdAt"
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.resolve_telegram_user(text, timestamptz) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.resolve_telegram_user(text, timestamptz) TO service_role';
  END IF;
END;
$grant$;
