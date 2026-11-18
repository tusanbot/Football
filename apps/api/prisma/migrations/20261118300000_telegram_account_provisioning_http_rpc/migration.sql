-- Atomically provision Telegram accounts, starter assets, club, coach and squad.
-- The caller must verify Telegram initData/session or the authenticated Bot secret first.
CREATE OR REPLACE FUNCTION public.provision_telegram_account(
  p_telegram_id text,
  p_username text,
  p_display_name text,
  p_first_name text,
  p_starter_players jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  user_row public."User"%ROWTYPE;
  club_row public."Club"%ROWTYPE;
  cash_amount bigint := 20000;
  gold_amount bigint := 50;
  setting_row record;
  player_row jsonb;
  player_count integer;
  assigned_count integer;
  slot_positions text[] := ARRAY['GK','RB','CB','CB','LB','CDM','CM','CAM','RW','ST','LW'];
  lineup_ids text[] := ARRAY[]::text[];
  chosen_player_id text;
  slot_index integer;
  wallet_rows jsonb;
  created_user boolean := false;
BEGIN
  IF p_telegram_id IS NULL OR p_telegram_id !~ '^[0-9]{1,20}$'
    OR p_display_name IS NULL OR length(btrim(p_display_name)) NOT BETWEEN 1 AND 256
    OR p_first_name IS NULL OR length(btrim(p_first_name)) NOT BETWEEN 1 AND 128
    OR (p_username IS NOT NULL AND length(p_username) > 64)
    OR jsonb_typeof(p_starter_players) <> 'array' OR jsonb_array_length(p_starter_players) <> 18 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_ACCOUNT_PROVISIONING_INPUT', ERRCODE = '22023';
  END IF;

  -- Serialize concurrent first logins for the same Telegram identity.
  PERFORM pg_advisory_xact_lock(hashtextextended('telegram-account:' || p_telegram_id, 0));

  FOR setting_row IN
    SELECT key, value FROM public."GameSetting"
    WHERE key IN ('economy.starterCash', 'economy.starterGold')
  LOOP
    IF jsonb_typeof(setting_row.value) = 'number'
      AND (setting_row.value #>> '{}') ~ '^[0-9]{1,12}$' THEN
      IF setting_row.key = 'economy.starterCash'
        AND (setting_row.value #>> '{}')::numeric <= 1000000000 THEN
        cash_amount := (setting_row.value #>> '{}')::bigint;
      ELSIF setting_row.key = 'economy.starterGold'
        AND (setting_row.value #>> '{}')::numeric <= 1000000 THEN
        gold_amount := (setting_row.value #>> '{}')::bigint;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public."User" (id, "telegramId", username, "displayName", "createdAt", "updatedAt", "lastActiveAt")
  VALUES (gen_random_uuid()::text, p_telegram_id, p_username, p_display_name, now(), now(), now())
  ON CONFLICT ("telegramId") DO NOTHING
  RETURNING * INTO user_row;
  IF FOUND THEN
    created_user := true;
  ELSE
    UPDATE public."User"
    SET username = p_username, "displayName" = p_display_name, "updatedAt" = now()
    WHERE "telegramId" = p_telegram_id
    RETURNING * INTO user_row;
  END IF;

  IF user_row."isSuspended" THEN
    RAISE EXCEPTION USING MESSAGE = 'ACCOUNT_SUSPENDED', ERRCODE = '42501';
  END IF;

  SELECT * INTO club_row FROM public."Club" WHERE "ownerId" = user_row.id FOR UPDATE;
  IF created_user THEN
    INSERT INTO public."Club" (id, "ownerId", name, slug, "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, user_row.id, left(btrim(p_first_name), 120) || ' FC',
      'club-' || p_telegram_id, now(), now())
    RETURNING * INTO club_row;

    INSERT INTO public."Wallet" (id, "userId", asset, balance, version, "createdAt", "updatedAt")
    VALUES
      (gen_random_uuid()::text, user_row.id, 'CASH', cash_amount, 0, now(), now()),
      (gen_random_uuid()::text, user_row.id, 'GOLD', gold_amount, 0, now(), now()),
      (gen_random_uuid()::text, user_row.id, 'HONOR', 0, 0, now(), now())
    ON CONFLICT ("userId", asset) DO NOTHING;

    IF cash_amount > 0 THEN
      INSERT INTO public."LedgerTransaction"
        (id, "idempotencyKey", "userId", asset, direction, amount, reason, "referenceType", "referenceId")
      VALUES (gen_random_uuid()::text, 'starter:' || p_telegram_id || ':CASH', user_row.id,
        'CASH', 'CREDIT', cash_amount, 'STARTER_GRANT', 'STARTER_GRANT', user_row.id)
      ON CONFLICT ("idempotencyKey") DO NOTHING;
    END IF;
    IF gold_amount > 0 THEN
      INSERT INTO public."LedgerTransaction"
        (id, "idempotencyKey", "userId", asset, direction, amount, reason, "referenceType", "referenceId")
      VALUES (gen_random_uuid()::text, 'starter:' || p_telegram_id || ':GOLD', user_row.id,
        'GOLD', 'CREDIT', gold_amount, 'STARTER_GRANT', 'STARTER_GRANT', user_row.id)
      ON CONFLICT ("idempotencyKey") DO NOTHING;
    END IF;
  ELSE
    INSERT INTO public."Wallet" (id, "userId", asset, balance, version, "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, user_row.id, 'HONOR', 0, 0, now(), now())
    ON CONFLICT ("userId", asset) DO NOTHING;
  END IF;

  IF club_row.id IS NOT NULL THEN
    INSERT INTO public."Coach" (id, "clubId", name, level, "trainingSkill", "recoverySkill", "medicalSkill", "weeklySalary", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, club_row.id, 'Academy Coach', 1, 35, 30, 25, 100, now(), now())
    ON CONFLICT ("clubId") DO NOTHING;

    SELECT count(*) INTO player_count FROM public."Player" WHERE "clubId" = club_row.id;
  ELSE
    player_count := 1;
  END IF;
  IF club_row.id IS NOT NULL AND player_count = 0 THEN
    FOR player_row IN SELECT value FROM jsonb_array_elements(p_starter_players)
    LOOP
      IF player_row->>'position' NOT IN ('GK','RB','LB','CB','CDM','CM','CAM','RW','LW','ST')
        OR player_row->>'nationality' !~ '^[A-Z]{2}$'
        OR (player_row->>'age')::integer NOT BETWEEN 18 AND 34
        OR (player_row->>'overall')::integer NOT BETWEEN 20 AND 95
        OR (player_row->>'potential')::integer NOT BETWEEN (player_row->>'overall')::integer AND 95
        OR (player_row->>'wage') !~ '^[0-9]{1,12}$'
        OR (player_row->>'contractDays')::integer NOT BETWEEN 1 AND 5000
        OR jsonb_typeof(player_row->'attributes') <> 'object' THEN
        RAISE EXCEPTION USING MESSAGE = 'INVALID_STARTER_PLAYER', ERRCODE = '22023';
      END IF;
      INSERT INTO public."Player" (
        id, "clubId", "firstName", "lastName", nationality, age, position, overall,
        potential, attributes, wage, "contractDays", origin, status, "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, club_row.id, left(player_row->>'firstName', 80),
        left(player_row->>'lastName', 80), player_row->>'nationality',
        (player_row->>'age')::integer, (player_row->>'position')::"PlayerPosition",
        (player_row->>'overall')::integer, (player_row->>'potential')::integer,
        player_row->'attributes', (player_row->>'wage')::bigint,
        (player_row->>'contractDays')::integer, 'GENERATED', 'ACTIVE', now(), now()
      );
    END LOOP;
  END IF;

  IF club_row.id IS NOT NULL THEN
    SELECT count(*) INTO assigned_count FROM public."Player"
    WHERE "clubId" = club_row.id AND "lineupSlot" IS NOT NULL;
  ELSE
    assigned_count := 1;
  END IF;
  IF club_row.id IS NOT NULL AND assigned_count = 0 THEN
    FOR slot_index IN 1..array_length(slot_positions, 1)
    LOOP
      SELECT id INTO chosen_player_id
      FROM public."Player"
      WHERE "clubId" = club_row.id AND status = 'ACTIVE'
        AND "lineupSlot" IS NULL AND position::text = slot_positions[slot_index]
      ORDER BY overall DESC, id ASC
      LIMIT 1
      FOR UPDATE;
      IF chosen_player_id IS NULL THEN
        lineup_ids := ARRAY[]::text[];
        EXIT;
      END IF;
      lineup_ids := array_append(lineup_ids, chosen_player_id);
      chosen_player_id := NULL;
    END LOOP;
    IF cardinality(lineup_ids) = 11 THEN
      UPDATE public."Player" AS player
      SET "lineupSlot" = lineup.slot_number, "updatedAt" = now()
      FROM unnest(lineup_ids) WITH ORDINALITY AS lineup(player_id, slot_number)
      WHERE player.id = lineup.player_id;
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('asset', asset::text, 'balance', balance::text)
    ORDER BY asset), '[]'::jsonb) INTO wallet_rows
  FROM public."Wallet" WHERE "userId" = user_row.id;

  RETURN jsonb_build_object(
    'id', user_row.id,
    'telegramId', user_row."telegramId",
    'displayName', user_row."displayName",
    'club', CASE WHEN club_row.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', club_row.id, 'name', club_row.name, 'level', club_row.level,
      'reputation', club_row.reputation) END,
    'wallets', wallet_rows
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.provision_telegram_account(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.provision_telegram_account(text, text, text, text, jsonb) TO service_role';
  END IF;
END;
$grant$;
