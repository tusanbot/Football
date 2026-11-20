-- Create a market listing and reserve the player in one transaction.
CREATE OR REPLACE FUNCTION public.create_market_listing(
  p_user_id text,
  p_player_id text,
  p_asking_price text,
  p_expires_in_hours integer
)
RETURNS TABLE(
  listing_id text,
  player_id text,
  asking_price text,
  status text,
  expires_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  club_row public."Club"%ROWTYPE;
  player_row public."Player"%ROWTYPE;
  eligible_count integer;
  has_goalkeeper boolean;
  listing_id_value text;
  expires_at_value timestamptz;
  created_at_value timestamptz := clock_timestamp();
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) = 0
    OR p_player_id IS NULL OR length(p_player_id) = 0
    OR p_asking_price IS NULL OR p_asking_price !~ '^[1-9][0-9]{0,14}$'
    OR p_expires_in_hours IS NULL OR p_expires_in_hours < 1 OR p_expires_in_hours > 168 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_LISTING', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO club_row
  FROM public."Club"
  WHERE "ownerId" = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO player_row
  FROM public."Player"
  WHERE id = p_player_id AND "clubId" = club_row.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'PLAYER_NOT_FOUND', ERRCODE = 'P0001';
  END IF;
  IF player_row.origin::text <> 'GENERATED' THEN
    RAISE EXCEPTION USING MESSAGE = 'SPECIAL_PLAYERS_NOT_TRADEABLE', ERRCODE = 'P0001';
  END IF;
  IF player_row.status::text <> 'ACTIVE' THEN
    RAISE EXCEPTION USING MESSAGE = 'PLAYER_NOT_AVAILABLE', ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."FootballMatch" match_row
    JOIN public."MatchRuntime" runtime_row ON runtime_row."matchId" = match_row.id
    WHERE match_row.status::text IN ('SCHEDULED', 'IN_PROGRESS')
      AND (match_row."homeClubId" = club_row.id OR match_row."awayClubId" = club_row.id)
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'MARKET_LOCKED_DURING_MATCH', ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer, coalesce(bool_or(position::text = 'GK'), false)
  INTO eligible_count, has_goalkeeper
  FROM public."Player"
  WHERE "clubId" = club_row.id
    AND status::text = 'ACTIVE'
    AND "suspensionMatchesRemaining" = 0
    AND id <> player_row.id;

  IF eligible_count < 11 OR NOT has_goalkeeper THEN
    RAISE EXCEPTION USING MESSAGE = 'MINIMUM_ACTIVE_SQUAD_REQUIRED', ERRCODE = 'P0001';
  END IF;

  UPDATE public."Player"
  SET status = 'LISTED', "lineupSlot" = NULL, "updatedAt" = created_at_value
  WHERE id = player_row.id AND "clubId" = club_row.id AND status::text = 'ACTIVE' AND origin::text = 'GENERATED';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'PLAYER_NOT_AVAILABLE', ERRCODE = 'P0001';
  END IF;

  IF player_row."lineupSlot" IS NOT NULL THEN
    UPDATE public."Club"
    SET "lineupVersion" = "lineupVersion" + 1, "updatedAt" = created_at_value
    WHERE id = club_row.id;
  END IF;

  listing_id_value := gen_random_uuid()::text;
  expires_at_value := created_at_value + make_interval(hours => p_expires_in_hours);
  INSERT INTO public."PlayerMarketListing" (
    id, "playerId", "sellerClubId", "askingPrice", status, "expiresAt", "createdAt", "updatedAt"
  ) VALUES (
    listing_id_value, player_row.id, club_row.id, p_asking_price::bigint, 'OPEN',
    expires_at_value, created_at_value, created_at_value
  );

  RETURN QUERY SELECT listing_id_value, player_row.id, p_asking_price, 'OPEN',
    expires_at_value, created_at_value;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_market_listing(text, text, text, integer) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_market_listing(text, text, text, integer) TO service_role';
  END IF;
END;
$grant$;
