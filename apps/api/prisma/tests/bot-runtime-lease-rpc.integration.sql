BEGIN;
DO $test$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_a uuid := '11111111-1111-4111-8111-111111111111';
  v_b uuid := '22222222-2222-4222-8222-222222222222';
  r jsonb;
BEGIN
  DELETE FROM public."BotRuntimeLease" WHERE id = 'telegram-bot-polling';
  r := public.manage_bot_runtime_lease_http(v_a, 'acquire', v_now, 60);
  IF r->>'acquired' <> 'true' OR r->>'released' <> 'false' OR r->>'leaseExpiresAt' IS NULL THEN
    RAISE EXCEPTION 'initial acquire failed: %', r;
  END IF;
  r := public.manage_bot_runtime_lease_http(v_b, 'acquire', v_now + interval '1 second', 60);
  IF r->>'acquired' <> 'false' THEN RAISE EXCEPTION 'exclusive acquire failed: %', r; END IF;
  r := public.manage_bot_runtime_lease_http(v_a, 'heartbeat', v_now + interval '2 seconds', 60);
  IF r->>'acquired' <> 'true' THEN RAISE EXCEPTION 'heartbeat failed: %', r; END IF;
  r := public.manage_bot_runtime_lease_http(v_b, 'heartbeat', v_now + interval '3 seconds', 60);
  IF r->>'acquired' <> 'false' THEN RAISE EXCEPTION 'foreign heartbeat unexpectedly succeeded: %', r; END IF;
  r := public.manage_bot_runtime_lease_http(v_b, 'release', v_now + interval '4 seconds', 60);
  IF r->>'released' <> 'false' THEN RAISE EXCEPTION 'foreign release unexpectedly succeeded: %', r; END IF;
  r := public.manage_bot_runtime_lease_http(v_a, 'release', v_now + interval '5 seconds', 60);
  IF r->>'released' <> 'true' THEN RAISE EXCEPTION 'release failed: %', r; END IF;
  r := public.manage_bot_runtime_lease_http(v_b, 'acquire', v_now + interval '6 seconds', 60);
  IF r->>'acquired' <> 'true' THEN RAISE EXCEPTION 'takeover after release failed: %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."BotRuntimeLease" WHERE id='telegram-bot-polling' AND "instanceId"=v_b::text) THEN
    RAISE EXCEPTION 'lease owner was not persisted';
  END IF;
  -- A crashed owner must not block polling forever: a new instance can take over
  -- after the persisted expiry, while the old instance can no longer heartbeat.
  r := public.manage_bot_runtime_lease_http(v_a, 'heartbeat', v_now + interval '67 seconds', 60);
  IF r->>'acquired' <> 'false' THEN
    RAISE EXCEPTION 'expired former owner unexpectedly renewed its lease: %', r;
  END IF;
  r := public.manage_bot_runtime_lease_http(v_a, 'acquire', v_now + interval '67 seconds', 60);
  IF r->>'acquired' <> 'true' THEN
    RAISE EXCEPTION 'expired lease takeover failed: %', r;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."BotRuntimeLease" WHERE id='telegram-bot-polling' AND "instanceId"=v_a::text) THEN
    RAISE EXCEPTION 'expired lease takeover did not persist the new owner';
  END IF;
END;
$test$;
ROLLBACK;
