CREATE OR REPLACE FUNCTION public.consume_alliance_action_rate_limit_http(p_telegram_user_id text,p_telegram_group_id text,p_action text,p_limit integer,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_key text; v_now_utc timestamp(3); v_window timestamp(3); v_allowed boolean;
BEGIN
 IF p_telegram_user_id IS NULL OR p_telegram_group_id IS NULL OR p_action IS NULL OR length(p_action)>200 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_now IS NULL THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_ALLIANCE_RATE_LIMIT',ERRCODE='22023';
 END IF;
 v_key:=left(p_telegram_user_id||':'||p_telegram_group_id||':'||p_action,240);
 v_now_utc:=(p_now AT TIME ZONE 'UTC')::timestamp(3);
 v_window:=date_trunc('minute',v_now_utc)::timestamp(3);
 INSERT INTO public."AllianceActionThrottle" AS throttle("key","windowStart","count","updatedAt")
 VALUES(v_key,v_window,1,v_now_utc)
 ON CONFLICT("key") DO UPDATE SET
  "windowStart"=EXCLUDED."windowStart",
  "count"=CASE WHEN throttle."windowStart"=EXCLUDED."windowStart" THEN throttle."count"+1 ELSE 1 END,
  "updatedAt"=EXCLUDED."updatedAt"
 WHERE public."AllianceActionThrottle"."windowStart"<>EXCLUDED."windowStart" OR public."AllianceActionThrottle"."count"<p_limit
 RETURNING true INTO v_allowed;
 RETURN jsonb_build_object('allowed',coalesce(v_allowed,false));
END $$;
REVOKE ALL ON FUNCTION public.consume_alliance_action_rate_limit_http(text,text,text,integer,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_alliance_action_rate_limit_http(text,text,text,integer,timestamptz) TO service_role;
