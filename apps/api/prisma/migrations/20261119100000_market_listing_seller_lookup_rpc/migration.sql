-- Resolve the seller owner through Supabase before the buyer/seller daily settlement.
-- The purchase RPC still revalidates the listing under row locks.
CREATE OR REPLACE FUNCTION public.get_market_listing_seller(p_listing_id text)
RETURNS TABLE(seller_user_id text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
  SELECT club."ownerId"
  FROM public."PlayerMarketListing" AS listing
  JOIN public."Club" AS club ON club.id = listing."sellerClubId"
  WHERE listing.id = p_listing_id
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.get_market_listing_seller(text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_market_listing_seller(text) TO service_role';
  END IF;
END;
$grant$;
