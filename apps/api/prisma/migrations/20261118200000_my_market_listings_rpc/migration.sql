CREATE OR REPLACE FUNCTION public.get_my_market_listings(p_user_id text)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  club_id_value text;
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_USER', ERRCODE = 'P0001';
  END IF;
  SELECT id INTO club_id_value FROM public."Club" WHERE "ownerId" = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'id', listing.id,
    'askingPrice', listing."askingPrice"::text,
    'status', listing.status::text,
    'expiresAt', listing."expiresAt",
    'createdAt', listing."createdAt",
    'player', jsonb_build_object(
      'id', player.id, 'firstName', player."firstName", 'lastName', player."lastName",
      'overall', player.overall, 'position', player.position::text,
      'marketValue', player."marketValue"::text
    )
  )
  FROM public."PlayerMarketListing" listing
  JOIN public."Player" player ON player.id = listing."playerId"
  WHERE listing."sellerClubId" = club_id_value
    AND listing.status::text IN ('OPEN', 'SOLD', 'CANCELLED', 'EXPIRED')
  ORDER BY listing."createdAt" DESC
  LIMIT 50;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_my_market_listings(text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_my_market_listings(text) TO service_role';
  END IF;
END;
$grant$;
