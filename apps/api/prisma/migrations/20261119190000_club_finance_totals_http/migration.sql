CREATE OR REPLACE FUNCTION public.get_club_finance_totals_http(
  p_club_id text,
  p_since timestamptz
) RETURNS TABLE(income text, expenses text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
  SELECT
    coalesce(sum(amount) FILTER (WHERE direction = 'CREDIT'), 0)::text,
    coalesce(sum(amount) FILTER (WHERE direction = 'DEBIT'), 0)::text
  FROM public."ClubFinanceEntry"
  WHERE "clubId" = p_club_id
    AND "occurredAt" >= p_since;
$function$;

REVOKE ALL ON FUNCTION public.get_club_finance_totals_http(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_club_finance_totals_http(text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_finance_totals_http(text, timestamptz) TO service_role;
