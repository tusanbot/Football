CREATE OR REPLACE FUNCTION public.consume_alliance_action_rate_limit_http(
  p_key text,
  p_window_start timestamptz,
  p_now timestamptz,
  p_limit integer
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_affected integer;
BEGIN
  IF p_key IS NULL OR length(btrim(p_key)) < 1 OR length(p_key) > 240
    OR p_window_start IS NULL OR p_now IS NULL
    OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_ACTION_RATE_LIMIT', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public."AllianceActionThrottle" AS throttle ("key", "windowStart", "count", "updatedAt")
  VALUES (p_key, p_window_start AT TIME ZONE 'UTC', 1, p_now AT TIME ZONE 'UTC')
  ON CONFLICT ("key") DO UPDATE
  SET "windowStart" = EXCLUDED."windowStart",
      "count" = CASE
        WHEN throttle."windowStart" = EXCLUDED."windowStart"
          THEN throttle."count" + 1
        ELSE 1
      END,
      "updatedAt" = EXCLUDED."updatedAt"
  WHERE throttle."windowStart" <> EXCLUDED."windowStart"
     OR throttle."count" < p_limit;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected = 1;
END;
$fn$;

REVOKE ALL ON FUNCTION public.consume_alliance_action_rate_limit_http(text, timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.consume_alliance_action_rate_limit_http(text, timestamptz, timestamptz, integer)
      TO service_role;
  END IF;
END;
$grant$;
