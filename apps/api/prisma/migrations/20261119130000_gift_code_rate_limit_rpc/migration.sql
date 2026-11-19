CREATE OR REPLACE FUNCTION public.consume_gift_code_rate_limit(p_telegram_user_id text, p_limit integer)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_window_start timestamp(3) := date_trunc('minute', clock_timestamp())::timestamp(3);
  v_key text;
  v_count integer;
BEGIN
  IF p_telegram_user_id IS NULL OR p_telegram_user_id = '' OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_RATE_LIMIT_ARGUMENTS', ERRCODE = 'P0001';
  END IF;
  v_key := left(p_telegram_user_id || ':global:gift-code-redeem', 240);
  INSERT INTO public."AllianceActionThrottle" ("key", "windowStart", "count", "updatedAt")
  VALUES (v_key, v_window_start, 1, v_now::timestamp(3))
  ON CONFLICT ("key") DO UPDATE
  SET "windowStart" = EXCLUDED."windowStart",
      "count" = CASE WHEN public."AllianceActionThrottle"."windowStart" = EXCLUDED."windowStart"
        THEN public."AllianceActionThrottle"."count" + 1 ELSE 1 END,
      "updatedAt" = EXCLUDED."updatedAt"
  WHERE public."AllianceActionThrottle"."windowStart" <> EXCLUDED."windowStart"
     OR public."AllianceActionThrottle"."count" < p_limit
  RETURNING "count" INTO v_count;
  RETURN FOUND;
END;
$function$;
REVOKE ALL ON FUNCTION public.consume_gift_code_rate_limit(text, integer) FROM PUBLIC, anon, authenticated;
DO $grant$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.consume_gift_code_rate_limit(text, integer) TO service_role';
  END IF;
END; $grant$;
