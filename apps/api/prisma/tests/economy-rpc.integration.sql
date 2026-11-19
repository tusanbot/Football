-- Transactional smoke tests for the production wallet RPC.
-- Run after all Prisma migrations against an ephemeral PostgreSQL database.
BEGIN;

DO $test$
DECLARE
  v_user_id text := 'ci-wallet-rpc-user';
  v_row record;
  v_message text;
  v_balance bigint;
  v_ledger_count bigint;
BEGIN
  INSERT INTO public."User" (id, "telegramId")
  VALUES (v_user_id, 'ci-wallet-rpc-telegram')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public."Wallet" (id, "userId", asset, balance, version)
  VALUES ('ci-wallet-rpc-wallet', v_user_id, 'CASH', 100, 0)
  ON CONFLICT ("userId", asset) DO UPDATE SET balance = 100, version = 0;

  SELECT * INTO v_row
  FROM public.apply_wallet_entry(
    v_user_id, 'CASH', 'DEBIT', 20, 'ci-wallet-debit-0001',
    'CI_WALLET_RPC_TEST', 'CI', 'wallet-debit'
  );
  IF v_row.balance <> '80' OR v_row.version <> 1 OR v_row.replayed THEN
    RAISE EXCEPTION 'wallet debit did not atomically update balance and version';
  END IF;

  SELECT * INTO v_row
  FROM public.apply_wallet_entry(
    v_user_id, 'CASH', 'DEBIT', 20, 'ci-wallet-debit-0001',
    'CI_WALLET_RPC_TEST', 'CI', 'wallet-debit'
  );
  IF v_row.balance <> '80' OR v_row.version <> 1 OR NOT v_row.replayed THEN
    RAISE EXCEPTION 'wallet idempotent replay changed the result';
  END IF;

  BEGIN
    PERFORM * FROM public.apply_wallet_entry(
      v_user_id, 'CASH', 'DEBIT', 21, 'ci-wallet-debit-0001',
      'CI_WALLET_RPC_TEST', 'CI', 'wallet-debit'
    );
    RAISE EXCEPTION 'expected IDEMPOTENCY_CONFLICT';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'IDEMPOTENCY_CONFLICT' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.apply_wallet_entry(
      v_user_id, 'CASH', 'DEBIT', 100, 'ci-wallet-debit-0002',
      'CI_WALLET_RPC_TEST', 'CI', 'insufficient-funds'
    );
    RAISE EXCEPTION 'expected INSUFFICIENT_FUNDS';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'INSUFFICIENT_FUNDS' THEN RAISE; END IF;
  END;

  SELECT balance INTO v_balance FROM public."Wallet"
  WHERE "userId" = v_user_id AND asset = 'CASH';
  SELECT count(*) INTO v_ledger_count FROM public."LedgerTransaction"
  WHERE "userId" = v_user_id AND "idempotencyKey" = 'ci-wallet-debit-0001';

  IF v_balance <> 80 OR v_ledger_count <> 1 THEN
    RAISE EXCEPTION 'failed wallet operation mutated balance or ledger';
  END IF;
END;
$test$;

ROLLBACK;
