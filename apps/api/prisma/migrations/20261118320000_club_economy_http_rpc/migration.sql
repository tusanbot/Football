-- Settle sponsor income and facility operating costs atomically over the Supabase HTTPS API.
CREATE OR REPLACE FUNCTION public.settle_club_economy(p_user_id text, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  club_row public."Club"%ROWTYPE;
  wallet_row public."Wallet"%ROWTYPE;
  today_date date;
  elapsed_days integer;
  first_accrual_day date;
  sponsor_income bigint := 0;
  daily_cost bigint;
  operating_cost bigint;
  available_cash bigint;
  paid_amount bigint;
  arrears_amount bigint;
  next_balance bigint;
  sponsor_row record;
  active_days integer;
  date_key text;
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) NOT BETWEEN 1 AND 128 OR p_now IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_SETTLEMENT_INPUT', ERRCODE = '22023';
  END IF;
  today_date := (p_now AT TIME ZONE 'UTC')::date;

  SELECT * INTO club_row FROM public."Club" WHERE "ownerId" = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'CLUB_NOT_FOUND', ERRCODE = 'P0002';
  END IF;

  elapsed_days := greatest(0, today_date - club_row."lastEconomyTickAt"::date);
  IF elapsed_days = 0 THEN
    RETURN jsonb_build_object('elapsedDays', 0, 'sponsorIncome', '0', 'operatingCost', '0',
      'paid', '0', 'arrears', club_row."operatingArrears"::text);
  END IF;

  first_accrual_day := club_row."lastEconomyTickAt"::date + 1;
  FOR sponsor_row IN
    SELECT id, "dailyIncome", "startedAt", "endsAt"
    FROM public."SponsorContract"
    WHERE "clubId" = club_row.id AND status = 'ACTIVE'
    ORDER BY id
    FOR UPDATE
  LOOP
    active_days := greatest(0,
      least(sponsor_row."endsAt"::date, today_date)
      - greatest(sponsor_row."startedAt"::date, first_accrual_day) + 1);
    IF active_days > 0 THEN
      sponsor_income := sponsor_income + sponsor_row."dailyIncome" * active_days;
    END IF;
    IF sponsor_row."endsAt" <= p_now THEN
      UPDATE public."SponsorContract" SET status = 'EXPIRED' WHERE id = sponsor_row.id;
    END IF;
  END LOOP;

  daily_cost := club_row."stadiumLevel" * 20
    + club_row."trainingGroundLevel" * 15 + club_row."academyLevel" * 10;
  operating_cost := daily_cost * elapsed_days + club_row."operatingArrears";

  SELECT * INTO wallet_row
  FROM public."Wallet"
  WHERE "userId" = p_user_id AND asset = 'CASH'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'WALLET_NOT_FOUND', ERRCODE = 'P0002';
  END IF;

  IF sponsor_income > 9223372036854775807 - wallet_row.balance THEN
    RAISE EXCEPTION USING MESSAGE = 'CONCURRENT_MODIFICATION', ERRCODE = '22003';
  END IF;
  available_cash := wallet_row.balance + sponsor_income;
  paid_amount := least(available_cash, operating_cost);
  arrears_amount := operating_cost - paid_amount;
  next_balance := available_cash - paid_amount;
  date_key := to_char(today_date, 'YYYY-MM-DD');

  IF sponsor_income > 0 OR paid_amount > 0 THEN
    UPDATE public."Wallet"
    SET balance = next_balance, version = version + 1, "updatedAt" = p_now
    WHERE id = wallet_row.id AND balance = wallet_row.balance AND version = wallet_row.version;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE = 'CONCURRENT_MODIFICATION', ERRCODE = '40001';
    END IF;
  END IF;

  IF sponsor_income > 0 THEN
    INSERT INTO public."LedgerTransaction" (
      id, "idempotencyKey", "userId", asset, direction, amount, reason, "referenceType", "referenceId"
    ) VALUES (
      gen_random_uuid()::text, 'club-economy:' || club_row.id || ':' || date_key || ':sponsor',
      p_user_id, 'CASH', 'CREDIT', sponsor_income, 'SPONSOR_DAILY_INCOME', 'CLUB', club_row.id
    );
    INSERT INTO public."ClubFinanceEntry" (
      id, "idempotencyKey", "clubId", category, direction, amount, description, "occurredAt"
    ) VALUES (
      gen_random_uuid()::text, 'club-finance-daily:' || club_row.id || ':' || date_key || ':sponsor',
      club_row.id, 'SPONSOR_INCOME', 'CREDIT', sponsor_income,
      'Sponsor income for ' || elapsed_days || ' game day(s)', p_now
    );
  END IF;

  IF paid_amount > 0 THEN
    INSERT INTO public."LedgerTransaction" (
      id, "idempotencyKey", "userId", asset, direction, amount, reason, "referenceType", "referenceId"
    ) VALUES (
      gen_random_uuid()::text, 'club-economy:' || club_row.id || ':' || date_key || ':maintenance',
      p_user_id, 'CASH', 'DEBIT', paid_amount, 'CLUB_FACILITY_MAINTENANCE', 'CLUB', club_row.id
    );
  END IF;

  IF operating_cost > 0 THEN
    INSERT INTO public."ClubFinanceEntry" (
      id, "idempotencyKey", "clubId", category, direction, amount, description, "occurredAt"
    ) VALUES (
      gen_random_uuid()::text, 'club-finance-daily:' || club_row.id || ':' || date_key || ':maintenance',
      club_row.id, 'FACILITY_MAINTENANCE', 'DEBIT', operating_cost,
      'Facility maintenance accrued; paid ' || paid_amount::text, p_now
    );
  END IF;

  INSERT INTO public."ClubEconomyTick" (
    id, "clubId", "gameDate", "elapsedDays", income, expenses, paid, arrears, "createdAt"
  ) VALUES (
    gen_random_uuid()::text, club_row.id, today_date, elapsed_days,
    sponsor_income, operating_cost, paid_amount, arrears_amount, p_now
  );

  UPDATE public."Club"
  SET "lastEconomyTickAt" = today_date, "operatingArrears" = arrears_amount, "updatedAt" = p_now
  WHERE id = club_row.id AND "ownerId" = p_user_id;

  RETURN jsonb_build_object('elapsedDays', elapsed_days, 'sponsorIncome', sponsor_income::text,
    'operatingCost', operating_cost::text, 'paid', paid_amount::text, 'arrears', arrears_amount::text);
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_club_economy(text, timestamptz) FROM PUBLIC, anon, authenticated;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.settle_club_economy(text, timestamptz) TO service_role';
  END IF;
END;
$grant$;
