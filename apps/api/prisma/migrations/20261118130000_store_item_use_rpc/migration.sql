-- Atomic store-item consumption and player-stat update.
DROP FUNCTION IF EXISTS public.use_store_item(text, text, text, integer, integer, text);
CREATE OR REPLACE FUNCTION public.use_store_item(
  p_user_id text,
  p_item_key text,
  p_player_id text,
  p_fitness_delta integer,
  p_morale_delta integer,
  p_idempotency_key text
)
RETURNS TABLE(item_key text, player_id text, inventory integer, fitness integer, morale integer, replayed boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  club_id text;
  player_row public."Player"%ROWTYPE;
  inventory_row public."StoreInventoryItem"%ROWTYPE;
  previous public."StoreItemUse"%ROWTYPE;
  inserted_id text;
  remaining_quantity integer;
  updated_fitness integer;
  updated_morale integer;
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) = 0 OR p_player_id IS NULL OR length(p_player_id) = 0
     OR p_item_key IS NULL OR p_item_key !~ '^[a-z][a-z0-9_]{1,63}$' THEN
    RAISE EXCEPTION USING MESSAGE = 'STORE_ITEM_NOT_FOUND', ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 OR length(p_idempotency_key) > 80
     OR p_idempotency_key !~ '^[A-Za-z0-9:_-]+$' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_IDEMPOTENCY_KEY', ERRCODE = 'P0001';
  END IF;
  IF p_fitness_delta IS NULL OR p_morale_delta IS NULL
     OR p_fitness_delta < 0 OR p_fitness_delta > 100
     OR p_morale_delta < 0 OR p_morale_delta > 100
     OR (p_fitness_delta = 0 AND p_morale_delta = 0) THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_STORE_ITEM_EFFECT', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO previous
  FROM public."StoreItemUse"
  WHERE "idempotencyKey" = p_idempotency_key;
  IF FOUND THEN
    IF previous."userId" <> p_user_id OR previous."itemKey" <> p_item_key OR previous."playerId" <> p_player_id THEN
      RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT', ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE((
      SELECT stock."quantity" FROM public."StoreInventoryItem" AS stock
      WHERE stock."userId" = p_user_id AND stock."itemKey" = p_item_key
    ), 0) INTO remaining_quantity;
    RETURN QUERY SELECT p_item_key, p_player_id, remaining_quantity, NULL::integer, NULL::integer, TRUE;
    RETURN;
  END IF;

  SELECT club.id INTO club_id
  FROM public."Club" AS club
  WHERE club."ownerId" = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO player_row
  FROM public."Player" AS player
  WHERE player.id = p_player_id AND player."clubId" = club_id
    AND player.status::text IN ('ACTIVE', 'INJURED')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'PLAYER_NOT_FOUND', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO inventory_row
  FROM public."StoreInventoryItem"
  WHERE "userId" = p_user_id AND "itemKey" = p_item_key
  FOR UPDATE;
  IF NOT FOUND OR inventory_row.quantity < 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'ITEM_NOT_IN_INVENTORY', ERRCODE = 'P0001';
  END IF;

  -- Recheck after acquiring both locks so concurrent identical requests replay safely.
  SELECT * INTO previous
  FROM public."StoreItemUse"
  WHERE "idempotencyKey" = p_idempotency_key;
  IF FOUND THEN
    IF previous."userId" <> p_user_id OR previous."itemKey" <> p_item_key OR previous."playerId" <> p_player_id THEN
      RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT', ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT p_item_key, p_player_id, inventory_row.quantity, NULL::integer, NULL::integer, TRUE;
    RETURN;
  END IF;

  IF (p_fitness_delta > 0 AND player_row.fitness >= 100)
     OR (p_morale_delta > 0 AND player_row.morale >= 100) THEN
    RAISE EXCEPTION USING MESSAGE = 'PLAYER_STAT_ALREADY_MAX', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public."StoreItemUse" (id, "idempotencyKey", "userId", "itemKey", "playerId")
  VALUES (gen_random_uuid()::text, p_idempotency_key, p_user_id, p_item_key, p_player_id)
  ON CONFLICT ("idempotencyKey") DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN
    SELECT * INTO previous FROM public."StoreItemUse" WHERE "idempotencyKey" = p_idempotency_key;
    IF NOT FOUND OR previous."userId" <> p_user_id OR previous."itemKey" <> p_item_key OR previous."playerId" <> p_player_id THEN
      RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT', ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT p_item_key, p_player_id, inventory_row.quantity, NULL::integer, NULL::integer, TRUE;
    RETURN;
  END IF;

  UPDATE public."StoreInventoryItem" AS stock
  SET quantity = stock.quantity - 1, "updatedAt" = NOW()
  WHERE stock.id = inventory_row.id AND stock.quantity > 0
  RETURNING stock.quantity INTO remaining_quantity;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'CONCURRENT_MODIFICATION', ERRCODE = 'P0001';
  END IF;

  UPDATE public."Player" AS player
  SET fitness = LEAST(100, player.fitness + p_fitness_delta),
      morale = LEAST(100, player.morale + p_morale_delta),
      "updatedAt" = NOW()
  WHERE player.id = player_row.id
  RETURNING player.fitness, player.morale INTO updated_fitness, updated_morale;

  RETURN QUERY SELECT p_item_key, p_player_id, remaining_quantity, updated_fitness, updated_morale, FALSE;
END;
$function$;

REVOKE ALL ON FUNCTION public.use_store_item(text, text, text, integer, integer, text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.use_store_item(text, text, text, integer, integer, text) TO service_role';
  END IF;
END;
$grant$;
