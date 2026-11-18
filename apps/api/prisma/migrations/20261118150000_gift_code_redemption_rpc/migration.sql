-- Atomic gift-code redemption, wallet credits, and group-point awards.
DROP FUNCTION IF EXISTS public.redeem_gift_code(text, text, text, text);
CREATE OR REPLACE FUNCTION public.redeem_gift_code(
  p_user_id text,
  p_code text,
  p_idempotency_key text,
  p_telegram_group_id text DEFAULT NULL
)
RETURNS TABLE(cash text, gold text, group_points text, replayed boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  gift_row public."GiftCode"%ROWTYPE;
  prior_redemption public."GiftCodeRedemption"%ROWTYPE;
  group_row public."TelegramGroup"%ROWTYPE;
  previous_code text;
  previous_group_telegram_id text;
  group_id text;
  user_redemptions bigint;
  new_wallet_balance bigint;
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) = 0 OR p_code IS NULL OR length(p_code) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'GIFT_CODE_UNAVAILABLE', ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 12 OR length(p_idempotency_key) > 128 THEN
    RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT', ERRCODE = 'P0001';
  END IF;

  SELECT * INTO prior_redemption
  FROM public."GiftCodeRedemption"
  WHERE "idempotencyKey" = p_idempotency_key;
  IF FOUND THEN
    SELECT code INTO previous_code FROM public."GiftCode" WHERE id = prior_redemption."giftCodeId";
    SELECT "telegramId" INTO previous_group_telegram_id FROM public."TelegramGroup" WHERE id = prior_redemption."groupId";
    IF prior_redemption."userId" <> p_user_id OR previous_code <> p_code
       OR previous_group_telegram_id IS DISTINCT FROM p_telegram_group_id THEN
      RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT', ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT prior_redemption."cashAmount"::text, prior_redemption."goldAmount"::text,
      prior_redemption."groupPoints"::text, TRUE;
    RETURN;
  END IF;

  SELECT * INTO gift_row
  FROM public."GiftCode"
  WHERE code = p_code
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'GIFT_CODE_UNAVAILABLE', ERRCODE = 'P0001';
  END IF;

  -- Recheck after locking the code to serialize concurrent requests with the same key.
  SELECT * INTO prior_redemption
  FROM public."GiftCodeRedemption"
  WHERE "idempotencyKey" = p_idempotency_key;
  IF FOUND THEN
    SELECT code INTO previous_code FROM public."GiftCode" WHERE id = prior_redemption."giftCodeId";
    SELECT "telegramId" INTO previous_group_telegram_id FROM public."TelegramGroup" WHERE id = prior_redemption."groupId";
    IF prior_redemption."userId" <> p_user_id OR previous_code <> p_code
       OR previous_group_telegram_id IS DISTINCT FROM p_telegram_group_id THEN
      RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT', ERRCODE = 'P0001';
    END IF;
    RETURN QUERY SELECT prior_redemption."cashAmount"::text, prior_redemption."goldAmount"::text,
      prior_redemption."groupPoints"::text, TRUE;
    RETURN;
  END IF;

  IF NOT gift_row.active OR gift_row."startsAt" > NOW()
     OR (gift_row."expiresAt" IS NOT NULL AND gift_row."expiresAt" <= NOW()) THEN
    RAISE EXCEPTION USING MESSAGE = 'GIFT_CODE_UNAVAILABLE', ERRCODE = 'P0001';
  END IF;
  IF gift_row."redeemedCount" >= gift_row."maxRedemptions" THEN
    RAISE EXCEPTION USING MESSAGE = 'GIFT_CODE_EXHAUSTED', ERRCODE = 'P0001';
  END IF;
  SELECT COUNT(*) INTO user_redemptions
  FROM public."GiftCodeRedemption"
  WHERE "giftCodeId" = gift_row.id AND "userId" = p_user_id;
  IF user_redemptions >= gift_row."perUserLimit" THEN
    RAISE EXCEPTION USING MESSAGE = 'GIFT_CODE_USER_LIMIT', ERRCODE = 'P0001';
  END IF;

  group_id := NULL;
  IF gift_row."rewardType"::text = 'GROUP_POINTS' THEN
    IF p_telegram_group_id IS NULL OR length(p_telegram_group_id) = 0 THEN
      RAISE EXCEPTION USING MESSAGE = 'GIFT_CODE_GROUP_REQUIRED', ERRCODE = 'P0001';
    END IF;
    SELECT * INTO group_row
    FROM public."TelegramGroup"
    WHERE "telegramId" = p_telegram_group_id
    FOR UPDATE;
    IF NOT FOUND OR NOT group_row."isActive" OR group_row."isSuspended" THEN
      RAISE EXCEPTION USING MESSAGE = 'GIFT_CODE_GROUP_UNAVAILABLE', ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public."GroupMembership"
      WHERE "groupId" = group_row.id AND "userId" = p_user_id
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'GIFT_CODE_GROUP_MEMBERSHIP_REQUIRED', ERRCODE = 'P0001';
    END IF;
    IF gift_row."groupPoints" <= 0 OR group_row.points > 9223372036854775807 - gift_row."groupPoints" THEN
      RAISE EXCEPTION USING MESSAGE = 'CONCURRENT_MODIFICATION', ERRCODE = 'P0001';
    END IF;
    group_id := group_row.id;
  END IF;

  UPDATE public."GiftCode" AS target
  SET "redeemedCount" = target."redeemedCount" + 1
  WHERE target.id = gift_row.id AND target.active
    AND target."redeemedCount" < target."maxRedemptions";

  INSERT INTO public."GiftCodeRedemption" (
    id, "giftCodeId", "userId", "idempotencyKey", "cashAmount", "goldAmount", "groupPoints", "groupId", "redeemedAt"
  ) VALUES (
    gen_random_uuid()::text, gift_row.id, p_user_id, p_idempotency_key,
    gift_row."cashAmount", gift_row."goldAmount", gift_row."groupPoints", group_id, NOW()
  );

  IF gift_row."rewardType"::text = 'WALLET' AND gift_row."cashAmount" > 0 THEN
    INSERT INTO public."Wallet" AS target (
      id, "userId", asset, balance, version, "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid()::text, p_user_id, 'CASH', gift_row."cashAmount", 0, NOW(), NOW()
    )
    ON CONFLICT ("userId", "asset") DO UPDATE
    SET balance = target.balance + EXCLUDED.balance,
        version = target.version + 1,
        "updatedAt" = NOW()
    WHERE target.balance <= 9223372036854775807 - EXCLUDED.balance AND target.version < 2147483647
    RETURNING balance INTO new_wallet_balance;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'CONCURRENT_MODIFICATION', ERRCODE = 'P0001';
    END IF;
    INSERT INTO public."LedgerTransaction" (
      id, "idempotencyKey", "userId", asset, direction, amount, reason, "referenceType", "referenceId"
    ) VALUES (
      gen_random_uuid()::text, p_idempotency_key || ':CASH', p_user_id, 'CASH', 'CREDIT',
      gift_row."cashAmount", 'GIFT_CODE_REDEMPTION', 'GIFT_CODE', gift_row.id
    );
  END IF;

  IF gift_row."rewardType"::text = 'WALLET' AND gift_row."goldAmount" > 0 THEN
    INSERT INTO public."Wallet" AS target (
      id, "userId", asset, balance, version, "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid()::text, p_user_id, 'GOLD', gift_row."goldAmount", 0, NOW(), NOW()
    )
    ON CONFLICT ("userId", "asset") DO UPDATE
    SET balance = target.balance + EXCLUDED.balance,
        version = target.version + 1,
        "updatedAt" = NOW()
    WHERE target.balance <= 9223372036854775807 - EXCLUDED.balance AND target.version < 2147483647
    RETURNING balance INTO new_wallet_balance;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'CONCURRENT_MODIFICATION', ERRCODE = 'P0001';
    END IF;
    INSERT INTO public."LedgerTransaction" (
      id, "idempotencyKey", "userId", asset, direction, amount, reason, "referenceType", "referenceId"
    ) VALUES (
      gen_random_uuid()::text, p_idempotency_key || ':GOLD', p_user_id, 'GOLD', 'CREDIT',
      gift_row."goldAmount", 'GIFT_CODE_REDEMPTION', 'GIFT_CODE', gift_row.id
    );
  END IF;

  IF gift_row."rewardType"::text = 'GROUP_POINTS' THEN
    UPDATE public."TelegramGroup" AS target
    SET points = target.points + gift_row."groupPoints"
    WHERE target.id = group_id;
    INSERT INTO public."GroupPointLedger" (
      id, "idempotencyKey", "groupId", "userId", amount, source, description, "createdAt"
    ) VALUES (
      gen_random_uuid()::text, p_idempotency_key || ':GROUP_POINTS', group_id, p_user_id,
      gift_row."groupPoints", 'GIFT_CODE', 'Gift code redemption: ' || gift_row.code, NOW()
    );
  END IF;

  RETURN QUERY SELECT gift_row."cashAmount"::text, gift_row."goldAmount"::text,
    gift_row."groupPoints"::text, FALSE;
END;
$function$;

REVOKE ALL ON FUNCTION public.redeem_gift_code(text, text, text, text) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.redeem_gift_code(text, text, text, text) TO service_role';
  END IF;
END;
$grant$;
