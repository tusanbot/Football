-- Atomic Bot polling lease operations over Supabase HTTPS.
CREATE OR REPLACE FUNCTION public.manage_bot_runtime_lease_http(
  p_instance_id uuid,
  p_action text,
  p_now timestamptz DEFAULT now(),
  p_lease_seconds integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_now timestamp without time zone;
  v_expires timestamp without time zone;
  v_acquired boolean := false;
  v_released boolean := false;
BEGIN
  IF p_instance_id IS NULL OR p_action IS NULL OR p_action NOT IN ('acquire', 'heartbeat', 'release')
     OR p_now IS NULL OR p_lease_seconds IS NULL OR p_lease_seconds < 15 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_BOT_RUNTIME_LEASE', ERRCODE = 'P0001';
  END IF;
  v_now := p_now AT TIME ZONE 'UTC';
  v_expires := v_now + make_interval(secs => p_lease_seconds);

  IF p_action = 'release' THEN
    UPDATE public."BotRuntimeLease"
    SET "instanceId" = '', "lockedUntil" = v_now, "updatedAt" = v_now
    WHERE id = 'telegram-bot-polling' AND "instanceId" = p_instance_id::text;
    v_released := FOUND;
    RETURN jsonb_build_object('acquired', false, 'released', v_released, 'leaseExpiresAt', NULL);
  ELSIF p_action = 'heartbeat' THEN
    UPDATE public."BotRuntimeLease"
    SET "lockedUntil" = v_expires, "updatedAt" = v_now
    WHERE id = 'telegram-bot-polling'
      AND "instanceId" = p_instance_id::text
      AND "lockedUntil" > v_now;
    v_acquired := FOUND;
  ELSE
    INSERT INTO public."BotRuntimeLease" (id, "instanceId", "lockedUntil", "updatedAt")
    VALUES ('telegram-bot-polling', p_instance_id::text, v_expires, v_now)
    ON CONFLICT (id) DO UPDATE
      SET "instanceId" = EXCLUDED."instanceId",
          "lockedUntil" = EXCLUDED."lockedUntil",
          "updatedAt" = EXCLUDED."updatedAt"
      WHERE public."BotRuntimeLease"."instanceId" = EXCLUDED."instanceId"
         OR public."BotRuntimeLease"."lockedUntil" <= v_now;
    v_acquired := FOUND;
  END IF;

  RETURN jsonb_build_object(
    'acquired', v_acquired,
    'released', false,
    'leaseExpiresAt', to_char(v_expires, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.manage_bot_runtime_lease_http(uuid, text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.manage_bot_runtime_lease_http(uuid, text, timestamptz, integer) TO service_role';
  END IF;
END;
$grant$;
