-- Atomic special-player pack acquisition: card cap, gold debit, player and ledger.
DROP FUNCTION IF EXISTS public.acquire_special_player(text, text, text);
CREATE OR REPLACE FUNCTION public.acquire_special_player(
  p_user_id text,
  p_method text,
  p_idempotency_key text
)
RETURNS TABLE(
  acquisition_id text,
  player_id text,
  method text,
  special_player jsonb,
  gold_balance text,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  pack_price bigint;
  pack_rarity text;
  max_copies integer;
  club_id text;
  special_row public."SpecialPlayer"%ROWTYPE;
  wallet_row public."Wallet"%ROWTYPE;
  previous public."SpecialPlayerAcquisition"%ROWTYPE;
  copies bigint;
  first_name text;
  last_name text;
  created_player_id text;
  created_acquisition_id text;
  new_balance bigint;
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{8,80}$' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_IDEMPOTENCY_KEY', ERRCODE = 'P0001';
  END IF;

  CASE p_method
    WHEN 'epic_pack' THEN pack_price := 250; pack_rarity := 'EPIC'; max_copies := 10;
    WHEN 'legendary_pack' THEN pack_price := 2500; pack_rarity := 'LEGENDARY'; max_copies := 3;
    WHEN 'icon_pack' THEN pack_price := 25000; pack_rarity := 'ICON'; max_copies := 1;
    ELSE RAISE EXCEPTION USING MESSAGE = 'INVALID_ACQUISITION_METHOD', ERRCODE = 'P0001';
  END CASE;

  -- Serialize duplicate requests even when they would otherwise choose different cards.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
  SELECT * INTO previous
  FROM public."SpecialPlayerAcquisition"
  WHERE "idempotencyKey" = p_idempotency_key;
  IF FOUND THEN
    IF previous."userId" <> p_user_id OR previous.method <> p_method THEN
      RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT', ERRCODE = 'P0001';
    END IF;
    SELECT "balance" INTO new_balance
    FROM public."Wallet"
    WHERE "userId" = p_user_id AND asset::text = 'GOLD';
    RETURN QUERY
      SELECT previous.id, previous."playerId", previous.method,
        jsonb_build_object('id', sp.id, 'fullName', sp."fullName", 'rarity', sp.rarity::text, 'overall', sp.overall),
        COALESCE(new_balance, 0)::text, TRUE
      FROM public."SpecialPlayer" AS sp
      WHERE sp.id = previous."specialPlayerId";
    RETURN;
  END IF;

  SELECT id INTO club_id
  FROM public."Club"
  WHERE "ownerId" = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001';
  END IF;

  SELECT sp.* INTO special_row
  FROM public."SpecialPlayer" AS sp
  WHERE sp.active = TRUE
    AND sp.rarity::text = pack_rarity
    AND sp."acquisitionMethods" @> ARRAY[p_method]::text[]
    AND NOT EXISTS (
      SELECT 1 FROM public."Player" AS player
      WHERE player."specialPlayerId" = sp.id AND player."clubId" = club_id
    )
    AND (
      SELECT COUNT(*) FROM public."SpecialPlayerAcquisition" AS acquisition
      WHERE acquisition."specialPlayerId" = sp.id
    ) < max_copies
  ORDER BY random()
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'NO_AVAILABLE_PLAYERS', ERRCODE = 'P0001';
  END IF;

  -- Recheck per-card cap and per-club uniqueness after taking the card row lock.
  SELECT COUNT(*) INTO copies
  FROM public."SpecialPlayerAcquisition"
  WHERE "specialPlayerId" = special_row.id;
  IF copies >= max_copies OR EXISTS (
    SELECT 1 FROM public."Player"
    WHERE "specialPlayerId" = special_row.id AND "clubId" = club_id
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'NO_AVAILABLE_PLAYERS', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO wallet_row
  FROM public."Wallet"
  WHERE "userId" = p_user_id AND asset::text = 'GOLD'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'WALLET_NOT_FOUND', ERRCODE = 'P0001';
  END IF;
  IF wallet_row."balance" < pack_price THEN
    RAISE EXCEPTION USING MESSAGE = 'INSUFFICIENT_GOLD', ERRCODE = 'P0001';
  END IF;
  IF wallet_row."version" >= 2147483647 THEN
    RAISE EXCEPTION USING MESSAGE = 'CONCURRENT_MODIFICATION', ERRCODE = 'P0001';
  END IF;

  UPDATE public."SpecialPlayer"
  SET "updatedAt" = NOW()
  WHERE id = special_row.id;

  UPDATE public."Wallet" AS target
  SET "balance" = target."balance" - pack_price,
      "version" = target."version" + 1,
      "updatedAt" = NOW()
  WHERE target.id = wallet_row.id
    AND target."balance" = wallet_row."balance"
    AND target."version" = wallet_row."version"
  RETURNING "balance" INTO new_balance;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'CONCURRENT_MODIFICATION', ERRCODE = 'P0001';
  END IF;

  first_name := split_part(trim(special_row."fullName"), ' ', 1);
  last_name := btrim(substr(trim(special_row."fullName"), length(first_name) + 1));
  IF last_name IS NULL OR last_name = '' THEN
    last_name := 'Legend';
  END IF;

  INSERT INTO public."Player" (
    id, "clubId", "firstName", "lastName", nationality, age, position, overall, potential,
    attributes, wage, "contractDays", origin, status, "specialPlayerId", "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text, club_id, first_name, last_name, special_row.nationality, 28,
    COALESCE(special_row.positions[1], 'ST')::public."PlayerPosition",
    special_row.overall, special_row.potential, special_row.attributes,
    (special_row.overall * 3)::bigint, 365, 'SPECIAL', 'ACTIVE', special_row.id, NOW(), NOW()
  )
  RETURNING id INTO created_player_id;

  INSERT INTO public."SpecialPlayerAcquisition" (
    id, "idempotencyKey", "userId", "clubId", "specialPlayerId", "playerId", method, asset, amount, "createdAt"
  ) VALUES (
    gen_random_uuid()::text, p_idempotency_key, p_user_id, club_id, special_row.id,
    created_player_id, p_method, 'GOLD', pack_price, NOW()
  )
  RETURNING id INTO created_acquisition_id;

  INSERT INTO public."LedgerTransaction" (
    id, "idempotencyKey", "userId", asset, direction, amount, reason, "referenceType", "referenceId"
  ) VALUES (
    gen_random_uuid()::text, 'special-acquisition:' || p_idempotency_key, p_user_id, 'GOLD', 'DEBIT',
    pack_price, 'SPECIAL_PLAYER_ACQUISITION', 'SPECIAL_PLAYER_ACQUISITION', created_acquisition_id
  );

  RETURN QUERY SELECT created_acquisition_id, created_player_id, p_method,
    jsonb_build_object('id', special_row.id, 'fullName', special_row."fullName",
      'rarity', special_row.rarity::text, 'overall', special_row.overall),
    new_balance::text, FALSE;
END;
$function$;

REVOKE ALL ON FUNCTION public.acquire_special_player(text, text, text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.acquire_special_player(text, text, text) TO service_role';
  END IF;
END;
$grant$;
