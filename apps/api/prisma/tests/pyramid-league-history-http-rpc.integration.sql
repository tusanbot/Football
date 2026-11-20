BEGIN;
DO $test$
DECLARE
 v_now timestamptz:=CURRENT_TIMESTAMP;
 v_result jsonb;
BEGIN
 INSERT INTO public."User"(id,"telegramId","updatedAt")
 VALUES('ci-pyramid-history-user','919900002',v_now AT TIME ZONE 'UTC');
 INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt")
 VALUES('ci-pyramid-history-club','ci-pyramid-history-user','History Club','ci-pyramid-history-club',v_now AT TIME ZONE 'UTC');
 v_result:=public.get_pyramid_league_history_http('ci-pyramid-history-user');
 IF v_result->'club'->>'id' IS DISTINCT FROM 'ci-pyramid-history-club'
  OR (v_result->'stats'->>'appearances')::integer<>0
  OR jsonb_typeof(v_result->'tiers') IS DISTINCT FROM 'array'
  OR jsonb_typeof(v_result->'movements') IS DISTINCT FROM 'array'
  OR jsonb_typeof(v_result->'leagues') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'pyramid history response mismatch: %',v_result;
 END IF;
END;
$test$;
ROLLBACK;
