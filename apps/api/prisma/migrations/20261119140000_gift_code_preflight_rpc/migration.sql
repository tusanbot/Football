CREATE OR REPLACE FUNCTION public.get_gift_code_reward_type(p_code text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
  SELECT "rewardType"::text
  FROM public."GiftCode"
  WHERE code = upper(trim(p_code))
    AND active = TRUE
    AND "startsAt" <= NOW()
    AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.get_gift_code_reward_type(text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_gift_code_reward_type(text) TO service_role';
  END IF;
END;
$grant$;
