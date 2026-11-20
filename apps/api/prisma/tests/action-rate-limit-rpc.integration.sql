BEGIN;
SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_key text := 'ci-action-rate-limit-' || replace(gen_random_uuid()::text, '-', '');
  v_window timestamptz := '2026-11-20T09:00:00Z';
  v_first boolean;
  v_second boolean;
  v_third boolean;
  v_next_window boolean;
BEGIN
  v_first := public.consume_alliance_action_rate_limit_http(v_key, v_window, v_window, 2);
  v_second := public.consume_alliance_action_rate_limit_http(v_key, v_window, v_window + interval '1 second', 2);
  v_third := public.consume_alliance_action_rate_limit_http(v_key, v_window, v_window + interval '2 seconds', 2);
  v_next_window := public.consume_alliance_action_rate_limit_http(v_key, v_window + interval '1 minute', v_window + interval '1 minute', 2);
  IF NOT v_first OR NOT v_second OR v_third OR NOT v_next_window THEN
    RAISE EXCEPTION 'Action rate limit RPC did not enforce its fixed-window limit';
  END IF;
END;
$test$;
ROLLBACK;
