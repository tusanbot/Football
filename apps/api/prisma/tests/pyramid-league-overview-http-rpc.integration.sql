-- Verify the overview RPC returns the caller's league tiers and queue state.
BEGIN;
DO $test$
DECLARE
  v_now timestamptz:=CURRENT_TIMESTAMP;
  v_result jsonb;
BEGIN
  INSERT INTO public."User"(id,"telegramId","updatedAt")
  VALUES('ci-pyramid-overview-user','919900001',v_now AT TIME ZONE 'UTC');
  INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt")
  VALUES('ci-pyramid-overview-club','ci-pyramid-overview-user','Overview Club','ci-pyramid-overview-club',v_now AT TIME ZONE 'UTC');
  v_result:=public.get_pyramid_league_overview_http('ci-pyramid-overview-user');
  IF jsonb_array_length(v_result->'tiers')<>7
    OR v_result->>'season' IS NULL
    OR jsonb_typeof(v_result->'history') IS DISTINCT FROM 'array'
    OR jsonb_typeof(v_result->'promotionOffers') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'pyramid overview response shape mismatch: %',v_result;
  END IF;
  IF v_result->'tiers'->0->>'key' IS DISTINCT FROM 'BASE'
    OR v_result->'tiers'->6->>'key' IS DISTINCT FROM 'CHAMPIONS' THEN
    RAISE EXCEPTION 'pyramid tier ordering mismatch: %',v_result->'tiers';
  END IF;
END;
$test$;
ROLLBACK;
