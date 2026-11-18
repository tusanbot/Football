-- Atomic, idempotent wallet mutation for the Supabase HTTP runtime.
CREATE OR REPLACE FUNCTION public.apply_wallet_entry(
  p_user_id text,
  p_asset public."WalletAsset",
  p_direction public."LedgerDirection",
  p_amount bigint,
  p_idempotency_key text,
  p_reason text,
  p_reference_type text DEFAULT NULL,
  p_reference_id text DEFAULT NULL
)
RETURNS TABLE(ledger_id text, balance bigint, version integer, replayed boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  wallet_row public."Wallet"%ROWTYPE;
  previous public."LedgerTransaction"%ROWTYPE;
  inserted_id text;
  next_balance bigint;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_AMOUNT', ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 12 OR length(p_idempotency_key) > 128
     OR p_idempotency_key !~ '^[A-Za-z0-9:_-]+$' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_AMOUNT', ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR length(p_reason) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_AMOUNT', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO wallet_row
  FROM public."Wallet"
  WHERE "userId" = p_user_id AND "asset" = p_asset
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'WALLET_NOT_FOUND', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO previous
  FROM public."LedgerTransaction"
  WHERE "idempotencyKey" = p_idempotency_key;

  IF FOUND THEN
    IF previous."userId" <> p_user_id OR previous."asset" <> p_asset
       OR previous."direction" <> p_direction OR previous."amount" <> p_amount
       OR previous."reason" <> p_reason
       OR previous."referenceType" IS DISTINCT FROM p_reference_type
       OR previous."referenceId" IS DISTINCT FROM p_reference_id THEN
      RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT', ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT previous.id, wallet_row."balance", wallet_row."version", TRUE;
    RETURN;
  END IF;

  IF wallet_row."version" >= 2147483647 THEN
    RAISE EXCEPTION USING MESSAGE = 'CONCURRENT_MODIFICATION', ERRCODE = 'P0001';
  END IF;

  IF p_direction = 'DEBIT' THEN
    IF wallet_row."balance" < p_amount THEN
      RAISE EXCEPTION USING MESSAGE = 'INSUFFICIENT_FUNDS', ERRCODE = 'P0001';
    END IF;
    next_balance := wallet_row."balance" - p_amount;
  ELSE
    IF wallet_row."balance" > 9223372036854775807 - p_amount THEN
      RAISE EXCEPTION USING MESSAGE = 'INVALID_AMOUNT', ERRCODE = 'P0001';
    END IF;
    next_balance := wallet_row."balance" + p_amount;
  END IF;

  INSERT INTO public."LedgerTransaction" (
    id, "idempotencyKey", "userId", asset, direction, amount, reason,
    "referenceType", "referenceId"
  ) VALUES (
    gen_random_uuid()::text, p_idempotency_key, p_user_id, p_asset, p_direction, p_amount, p_reason,
    p_reference_type, p_reference_id
  )
  ON CONFLICT ("idempotencyKey") DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN
    SELECT * INTO previous
    FROM public."LedgerTransaction"
    WHERE "idempotencyKey" = p_idempotency_key;
    IF NOT FOUND OR previous."userId" <> p_user_id OR previous."asset" <> p_asset
       OR previous."direction" <> p_direction OR previous."amount" <> p_amount
       OR previous."reason" <> p_reason
       OR previous."referenceType" IS DISTINCT FROM p_reference_type
       OR previous."referenceId" IS DISTINCT FROM p_reference_id THEN
      RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT', ERRCODE = 'P0001';
    END IF;
    RETURN QUERY
      SELECT previous.id, current_wallet."balance", current_wallet."version", TRUE
      FROM public."Wallet" AS current_wallet
      WHERE current_wallet."userId" = p_user_id AND current_wallet."asset" = p_asset;
    RETURN;
  END IF;

  UPDATE public."Wallet" AS target
  SET "balance" = next_balance, "version" = target."version" + 1, "updatedAt" = NOW()
  WHERE target.id = wallet_row.id;

  RETURN QUERY SELECT inserted_id, next_balance, wallet_row."version" + 1, FALSE;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_wallet_entry(text, public."WalletAsset", public."LedgerDirection", bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.apply_wallet_entry(text, public."WalletAsset", public."LedgerDirection", bigint, text, text, text, text) TO service_role';
  END IF;
END;
$grant$;
