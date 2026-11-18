-- Expire stale market listings safely and return the current public market snapshot.
-- The bounded SKIP LOCKED batch prevents concurrent readers/schedulers from blocking one another.
CREATE OR REPLACE FUNCTION public.get_open_market_listings()
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  WITH expired AS MATERIALIZED (
    SELECT id, "playerId", "sellerClubId"
    FROM public."PlayerMarketListing"
    WHERE status::text = 'OPEN' AND "expiresAt" <= clock_timestamp()
    ORDER BY "expiresAt", id
    FOR UPDATE SKIP LOCKED
    LIMIT 500
  ),
  closed AS (
    UPDATE public."PlayerMarketListing" AS listing
    SET status = 'EXPIRED', "updatedAt" = clock_timestamp()
    FROM expired
    WHERE listing.id = expired.id AND listing.status::text = 'OPEN'
    RETURNING listing."playerId", listing."sellerClubId"
  )
  UPDATE public."Player" AS player
  SET status = CASE WHEN player."contractDays" > 0
      THEN 'ACTIVE'::public."PlayerStatus"
      ELSE 'CONTRACT_EXPIRED'::public."PlayerStatus" END,
      "updatedAt" = clock_timestamp()
  FROM closed
  WHERE player.id = closed."playerId"
    AND player."clubId" = closed."sellerClubId"
    AND player.status::text = 'LISTED';

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', listing.id,
    'askingPrice', listing."askingPrice"::text,
    'expiresAt', listing."expiresAt",
    'createdAt', listing."createdAt",
    'player', jsonb_build_object(
      'id', player.id,
      'firstName', player."firstName",
      'lastName', player."lastName",
      'nationality', player.nationality,
      'age', player.age,
      'position', player.position::text,
      'overall', player.overall,
      'potential', player.potential,
      'marketValue', player."marketValue"::text,
      'wage', player.wage::text
    ),
    'sellerClub', jsonb_build_object('id', club.id, 'name', club.name)
  )
  FROM public."PlayerMarketListing" AS listing
  JOIN public."Player" AS player
    ON player.id = listing."playerId"
   AND player."clubId" = listing."sellerClubId"
   AND player.status::text = 'LISTED'
  JOIN public."Club" AS club ON club.id = listing."sellerClubId"
  WHERE listing.status::text = 'OPEN'
    AND listing."expiresAt" > clock_timestamp()
  ORDER BY listing."createdAt" DESC
  LIMIT 50;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_open_market_listings() FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_open_market_listings() TO service_role';
  END IF;
END;
$grant$;
