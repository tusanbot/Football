-- Atomic player-market settlement: wallets, ledgers, finance entries and ownership move together.
DROP FUNCTION IF EXISTS public.buy_market_listing(text, text);
CREATE OR REPLACE FUNCTION public.buy_market_listing(
  p_user_id text,
  p_listing_id text
)
RETURNS TABLE(listing_id text, player_id text, price text, replayed boolean, error_code text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  listing_row public."PlayerMarketListing"%ROWTYPE;
  player_row public."Player"%ROWTYPE;
  buyer_wallet public."Wallet"%ROWTYPE;
  seller_wallet public."Wallet"%ROWTYPE;
  buyer_club_id text;
  seller_user_id text;
  now_time timestamptz := NOW();
  affected integer;
  price_text text;
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) = 0 OR p_listing_id IS NULL OR length(p_listing_id) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_AMOUNT', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO listing_row
  FROM public."PlayerMarketListing"
  WHERE id = p_listing_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'LISTING_NOT_FOUND', ERRCODE = 'P0001';
  END IF;

  price_text := listing_row."askingPrice"::text;

  SELECT id INTO buyer_club_id
  FROM public."Club"
  WHERE "ownerId" = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001';
  END IF;

  IF listing_row.status::text = 'SOLD' AND listing_row."buyerClubId" = buyer_club_id THEN
    RETURN QUERY SELECT listing_row.id, listing_row."playerId", price_text, TRUE, NULL::text;
    RETURN;
  END IF;
  IF listing_row.status::text <> 'OPEN' THEN
    RAISE EXCEPTION USING MESSAGE = 'LISTING_NOT_OPEN', ERRCODE = 'P0001';
  END IF;
  IF listing_row."sellerClubId" = buyer_club_id THEN
    RAISE EXCEPTION USING MESSAGE = 'CANNOT_BUY_OWN_PLAYER', ERRCODE = 'P0001';
  END IF;
  IF listing_row."askingPrice" IS NULL OR listing_row."askingPrice" <= 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_AMOUNT', ERRCODE = 'P0001';
  END IF;

  SELECT "ownerId" INTO seller_user_id
  FROM public."Club"
  WHERE id = listing_row."sellerClubId";
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'PLAYER_OWNERSHIP_CHANGED', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO player_row
  FROM public."Player"
  WHERE id = listing_row."playerId" AND "clubId" = listing_row."sellerClubId"
    AND status::text = 'LISTED' AND origin::text = 'GENERATED'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'PLAYER_OWNERSHIP_CHANGED', ERRCODE = 'P0001';
  END IF;

  IF player_row."contractDays" <= 0 THEN
    UPDATE public."PlayerMarketListing" AS target
    SET status = 'EXPIRED', "updatedAt" = NOW()
    WHERE target.id = listing_row.id AND target.status::text = 'OPEN';
    UPDATE public."Player" AS target
    SET status = 'CONTRACT_EXPIRED', "updatedAt" = NOW()
    WHERE target.id = player_row.id AND target.status::text = 'LISTED';
    RETURN QUERY SELECT listing_row.id, listing_row."playerId", price_text, FALSE, 'PLAYER_CONTRACT_EXPIRED'::text;
    RETURN;
  END IF;

  IF listing_row."expiresAt" <= now_time THEN
    UPDATE public."PlayerMarketListing" AS target
    SET status = 'EXPIRED', "updatedAt" = NOW()
    WHERE target.id = listing_row.id AND target.status::text = 'OPEN';
    UPDATE public."Player" AS target
    SET status = CASE WHEN player_row."contractDays" > 0 THEN 'ACTIVE' ELSE 'CONTRACT_EXPIRED' END,
        "updatedAt" = NOW()
    WHERE target.id = player_row.id AND target.status::text = 'LISTED';
    RETURN QUERY SELECT listing_row.id, listing_row."playerId", price_text, FALSE, 'LISTING_EXPIRED'::text;
    RETURN;
  END IF;

  -- Lock both cash wallets in a stable order to prevent buyer/seller deadlocks.
  PERFORM 1
  FROM public."Wallet" AS wallet
  WHERE wallet."userId" IN (p_user_id, seller_user_id) AND wallet."asset"::text = 'CASH'
  ORDER BY wallet."userId"
  FOR UPDATE;

  SELECT * INTO buyer_wallet
  FROM public."Wallet"
  WHERE "userId" = p_user_id AND "asset"::text = 'CASH';
  SELECT * INTO seller_wallet
  FROM public."Wallet"
  WHERE "userId" = seller_user_id AND "asset"::text = 'CASH';
  IF buyer_wallet.id IS NULL OR seller_wallet.id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'WALLET_NOT_FOUND', ERRCODE = 'P0001';
  END IF;
  IF buyer_wallet."balance" < listing_row."askingPrice" THEN
    RAISE EXCEPTION USING MESSAGE = 'INSUFFICIENT_FUNDS', ERRCODE = 'P0001';
  END IF;
  IF seller_wallet."balance" > 9223372036854775807 - listing_row."askingPrice"
     OR buyer_wallet."version" >= 2147483647 OR seller_wallet."version" >= 2147483647 THEN
    RAISE EXCEPTION USING MESSAGE = 'CONCURRENT_MODIFICATION', ERRCODE = 'P0001';
  END IF;

  UPDATE public."Wallet" AS target
  SET "balance" = target."balance" - listing_row."askingPrice",
      "version" = target."version" + 1, "updatedAt" = NOW()
  WHERE target.id = buyer_wallet.id;
  UPDATE public."Wallet" AS target
  SET "balance" = target."balance" + listing_row."askingPrice",
      "version" = target."version" + 1, "updatedAt" = NOW()
  WHERE target.id = seller_wallet.id;

  UPDATE public."PlayerMarketListing" AS target
  SET status = 'SOLD', "buyerClubId" = buyer_club_id, "updatedAt" = NOW()
  WHERE target.id = listing_row.id AND target.status::text = 'OPEN' AND target."expiresAt" > now_time;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'LISTING_NOT_OPEN', ERRCODE = 'P0001';
  END IF;

  UPDATE public."Player" AS target
  SET "clubId" = buyer_club_id, status = 'ACTIVE', "updatedAt" = NOW()
  WHERE target.id = player_row.id AND target."clubId" = listing_row."sellerClubId"
    AND target.status::text = 'LISTED' AND target.origin::text = 'GENERATED';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'PLAYER_OWNERSHIP_CHANGED', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public."LedgerTransaction" (
    id, "idempotencyKey", "userId", asset, direction, amount, reason, "referenceType", "referenceId"
  ) VALUES
    (gen_random_uuid()::text, 'market:' || listing_row.id || ':buyer', p_user_id, 'CASH', 'DEBIT',
      listing_row."askingPrice", 'PLAYER_MARKET_PURCHASE', 'PLAYER_MARKET_LISTING', listing_row.id),
    (gen_random_uuid()::text, 'market:' || listing_row.id || ':seller', seller_user_id, 'CASH', 'CREDIT',
      listing_row."askingPrice", 'PLAYER_MARKET_SALE', 'PLAYER_MARKET_LISTING', listing_row.id);


  INSERT INTO public."ClubFinanceEntry" (
    id, "idempotencyKey", "clubId", category, direction, amount, description
  ) VALUES
    (gen_random_uuid()::text, 'club-finance-market:' || listing_row.id || ':buyer', buyer_club_id,
      'PLAYER_MARKET_PURCHASE', 'DEBIT', listing_row."askingPrice",
      'Transfer purchase: ' || player_row."firstName" || ' ' || player_row."lastName"),
    (gen_random_uuid()::text, 'club-finance-market:' || listing_row.id || ':seller', listing_row."sellerClubId",
      'PLAYER_MARKET_SALE', 'CREDIT', listing_row."askingPrice",
      'Transfer sale: ' || player_row."firstName" || ' ' || player_row."lastName");


  RETURN QUERY SELECT listing_row.id, player_row.id, price_text, FALSE, NULL::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.buy_market_listing(text, text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.buy_market_listing(text, text) TO service_role';
  END IF;
END;
$grant$;
