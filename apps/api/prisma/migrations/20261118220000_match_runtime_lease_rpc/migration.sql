-- Atomic, concurrency-safe match runtime leases for the Cloudflare HTTP worker.
CREATE OR REPLACE FUNCTION public.claim_due_match_runtimes(
  p_worker_id text, p_now timestamptz, p_lease_ms integer, p_limit integer
)
RETURNS TABLE(runtime_id text, lease_token text, lease_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_worker_id IS NULL OR length(btrim(p_worker_id)) NOT BETWEEN 1 AND 100
    OR p_lease_ms NOT BETWEEN 1000 AND 3600000 OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'INVALID_MATCH_WORKER_LEASE';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT runtime."id"
    FROM public."MatchRuntime" AS runtime
    WHERE runtime."status"::text IN ('QUEUED', 'RUNNING', 'AWAITING_CHECKPOINT')
      AND runtime."nextActionAt" <= p_now
      AND (runtime."leaseExpiresAt" IS NULL OR runtime."leaseExpiresAt" <= p_now)
    ORDER BY runtime."nextActionAt" ASC, runtime."createdAt" ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public."MatchRuntime" AS runtime
  SET "leaseOwner" = p_worker_id,
      "leaseToken" = gen_random_uuid()::text,
      "leaseExpiresAt" = p_now + make_interval(secs => p_lease_ms::double precision / 1000),
      "updatedAt" = p_now
  FROM due
  WHERE runtime."id" = due."id"
  RETURNING runtime."id", runtime."leaseToken", runtime."leaseExpiresAt";
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_match_runtime_lease(
  p_runtime_id text, p_lease_token text, p_next_action_at timestamptz, p_last_error text
)
RETURNS TABLE(released boolean)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
  WITH changed AS (
    UPDATE public."MatchRuntime"
    SET "leaseOwner" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL,
        "nextActionAt" = p_next_action_at, "lastError" = left(p_last_error, 500),
        "updatedAt" = now()
    WHERE "id" = p_runtime_id AND "leaseToken" = p_lease_token
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$function$;

REVOKE ALL ON FUNCTION public.claim_due_match_runtimes(text, timestamptz, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_match_runtime_lease(text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.claim_due_match_runtimes(text, timestamptz, integer, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.release_match_runtime_lease(text, text, timestamptz, text) TO service_role;
  END IF;
END;
$grant$;
