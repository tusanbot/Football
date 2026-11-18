-- Cancel only the caller's open listing and restore player availability atomically.
CREATE OR REPLACE FUNCTION public.cancel_market_listing(
  p_user_id text,
  p_listing_id text
)
RETURNS TABLE(listing_id text, status text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  club_id_value text;
  listing_row public."PlayerMarketListing"%ROWTYPE;
  contract_days_value integer;
  updated_count integer;
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) = 0
    OR p_listing_id IS NULL OR length(p_listing_id) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_LISTING', ERRCODE = 'P0001';
  END IF;

  SELECT id INTO club_id_value
  FROM public."Club"
  WHERE "ownerId" = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO listing_row
  FROM public."PlayerMarketListing"
  WHERE id = p_listing_id AND "sellerClubId" = club_id_value
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'LISTING_NOT_FOUND', ERRCODE = 'P0001';
  END IF;
  IF listing_row.status::text <> 'OPEN' THEN
    RAISE EXCEPTION USING MESSAGE = 'LISTING_NOT_OPEN', ERRCODE = 'P0001';
  END IF;

  SELECT "contractDays" INTO contract_days_value
  FROM public."Player"
  WHERE id = listing_row."playerId"
    AND "clubId" = club_id_value
    AND status::text = 'LISTED'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'PLAYER_OWNERSHIP_CHANGED', ERRCODE = 'P0001';
  END IF;

  UPDATE public."PlayerMarketListing"
  SET status = 'CANCELLED', "updatedAt" = clock_timestamp()
  WHERE id = listing_row.id AND status::text = 'OPEN';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'LISTING_NOT_OPEN', ERRCODE = 'P0001';
  END IF;

  UPDATE public."Player"
  SET status = CASE WHEN contract_days_value > 0 THEN 'ACTIVE'::public."PlayerStatus"
                    ELSE 'CONTRACT_EXPIRED'::public."PlayerStatus" END,
      "updatedAt" = clock_timestamp()
  WHERE id = listing_row."playerId" AND "clubId" = club_id_value AND status::text = 'LISTED';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'PLAYER_OWNERSHIP_CHANGED', ERRCODE = 'P0001';
  END IF;

  RETURN QUERY SELECT listing_row.id, 'CANCELLED'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_market_listing(text, text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.cancel_market_listing(text, text) TO service_role';
  END IF;
END;
$grant$;
