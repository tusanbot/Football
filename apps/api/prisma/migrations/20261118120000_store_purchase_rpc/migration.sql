-- Atomic store purchase: wallet debit, ledger entry and inventory grant commit together.
DROP FUNCTION IF EXISTS public.purchase_store_item(text, text, public."WalletAsset", bigint, integer, text);
CREATE OR REPLACE FUNCTION public.purchase_store_item(
  p_user_id text,
  p_item_key text,
  p_asset public."WalletAsset",
  p_unit_price bigint,
  p_quantity integer,
  p_idempotency_key text
)
RETURNS TABLE(item_key text, purchased_quantity integer, balance text, inventory integer, replayed boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  wallet_row public."Wallet"%ROWTYPE;
  previous public."StorePurchase"%ROWTYPE;
  total_amount bigint;
  inventory_quantity integer;
  purchase_id text;
  ledger_id text;
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) = 0
     OR p_item_key IS NULL OR p_item_key !~ '^[a-z][a-z0-9_]{1,63}$'
     OR p_unit_price IS NULL OR p_unit_price <= 0
     OR p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 10 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_AMOUNT', ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 OR length(p_idempotency_key) > 80
     OR p_idempotency_key !~ '^[A-Za-z0-9:_-]+$' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_IDEMPOTENCY_KEY', ERRCODE = 'P0001';
  END IF;
  IF p_unit_price > 9223372036854775807 / p_quantity THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_AMOUNT', ERRCODE = 'P0001';
  END IF;
  total_amount := p_unit_price * p_quantity::bigint;

  SELECT * INTO wallet_row
  FROM public."Wallet"
  WHERE "userId" = p_user_id AND "asset" = p_asset
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'WALLET_NOT_FOUND', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO previous
  FROM public."StorePurchase"
  WHERE "idempotencyKey" = p_idempotency_key;
  IF FOUND THEN
    IF previous."userId" <> p_user_id OR previous."itemKey" <> p_item_key
       OR previous."asset" <> p_asset OR previous."amount" <> total_amount
       OR previous."quantity" <> p_quantity THEN
      RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT', ERRCODE = 'P0001';
    END IF;
    SELECT "quantity" INTO inventory_quantity
    FROM public."StoreInventoryItem"
    WHERE "userId" = p_user_id AND "itemKey" = p_item_key;
    RETURN QUERY SELECT p_item_key, p_quantity, wallet_row."balance"::text, COALESCE(inventory_quantity, 0), TRUE;
    RETURN;
  END IF;

  IF wallet_row."balance" < total_amount THEN
    RAISE EXCEPTION USING MESSAGE = 'INSUFFICIENT_FUNDS', ERRCODE = 'P0001';
  END IF;
  IF wallet_row."version" >= 2147483647 THEN
    RAISE EXCEPTION USING MESSAGE = 'CONCURRENT_MODIFICATION', ERRCODE = 'P0001';
  END IF;

  SELECT "quantity" INTO inventory_quantity
  FROM public."StoreInventoryItem"
  WHERE "userId" = p_user_id AND "itemKey" = p_item_key
  FOR UPDATE;
  IF FOUND AND inventory_quantity > 2147483647 - p_quantity THEN
    RAISE EXCEPTION USING MESSAGE = 'STORE_INVENTORY_OVERFLOW', ERRCODE = 'P0001';
  END IF;

  INSERT INTO public."StorePurchase" (
    id, "idempotencyKey", "userId", "itemKey", asset, amount, quantity
  ) VALUES (
    gen_random_uuid()::text, p_idempotency_key, p_user_id, p_item_key, p_asset, total_amount, p_quantity
  )
  ON CONFLICT ("idempotencyKey") DO NOTHING
  RETURNING id INTO purchase_id;

  IF purchase_id IS NULL THEN
    SELECT * INTO previous
    FROM public."StorePurchase"
    WHERE "idempotencyKey" = p_idempotency_key;
    IF NOT FOUND OR previous."userId" <> p_user_id OR previous."itemKey" <> p_item_key
       OR previous."asset" <> p_asset OR previous."amount" <> total_amount
       OR previous."quantity" <> p_quantity THEN
      RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT', ERRCODE = 'P0001';
    END IF;
    SELECT "quantity" INTO inventory_quantity
    FROM public."StoreInventoryItem"
    WHERE "userId" = p_user_id AND "itemKey" = p_item_key;
    RETURN QUERY SELECT p_item_key, p_quantity, wallet_row."balance"::text, COALESCE(inventory_quantity, 0), TRUE;
    RETURN;
  END IF;

  INSERT INTO public."LedgerTransaction" (
    id, "idempotencyKey", "userId", asset, direction, amount, reason, "referenceType", "referenceId"
  ) VALUES (
    gen_random_uuid()::text, 'store-purchase:' || p_idempotency_key, p_user_id, p_asset, 'DEBIT',
    total_amount, 'STORE_PURCHASE', 'STORE_PURCHASE', purchase_id
  )
  ON CONFLICT ("idempotencyKey") DO NOTHING
  RETURNING id INTO ledger_id;
  IF ledger_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT', ERRCODE = 'P0001';
  END IF;

  UPDATE public."Wallet" AS target
  SET "balance" = target."balance" - total_amount,
      "version" = target."version" + 1,
      "updatedAt" = NOW()
  WHERE target.id = wallet_row.id;

  INSERT INTO public."StoreInventoryItem" AS current_inventory (
    id, "userId", "itemKey", quantity, "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text, p_user_id, p_item_key, p_quantity, NOW(), NOW()
  )
  ON CONFLICT ("userId", "itemKey") DO UPDATE
  SET quantity = current_inventory.quantity + EXCLUDED.quantity,
      "updatedAt" = NOW()
  RETURNING quantity INTO inventory_quantity;

  RETURN QUERY SELECT p_item_key, p_quantity, (wallet_row."balance" - total_amount)::text, inventory_quantity, FALSE;
END;
$function$;

REVOKE ALL ON FUNCTION public.purchase_store_item(text, text, public."WalletAsset", bigint, integer, text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.purchase_store_item(text, text, public."WalletAsset", bigint, integer, text) TO service_role';
  END IF;
END;
$grant$;
