-- Atomic administrative wallet and group-point adjustments.
-- Reuses apply_wallet_entry for wallet balance + ledger mutation; this RPC adds
-- the administrator audit record in the same transaction.
CREATE OR REPLACE FUNCTION public.admin_financial_adjustment_http(
 p_action text,
 p_target_id text,
 p_amount bigint,
 p_asset text,
 p_actor_telegram_id text,
 p_idempotency_key text,
 p_reason text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE
 v_existing public."AdminAuditLog"%ROWTYPE;
 v_user public."User"%ROWTYPE;
 v_group public."TelegramGroup"%ROWTYPE;
 v_wallet record;
 v_asset public."WalletAsset";
 v_direction public."LedgerDirection";
 v_abs_amount bigint;
 v_target_type text;
 v_balance text;
 v_points text;
 v_ledger_id text;
BEGIN
 IF p_action NOT IN ('adjust-wallet','adjust-group-points')
  OR p_target_id IS NULL OR length(p_target_id) NOT BETWEEN 1 AND 128
  OR p_amount IS NULL OR p_amount=0 OR p_amount=-9223372036854775808
  OR p_actor_telegram_id IS NULL OR p_actor_telegram_id !~ '^[0-9]{1,20}$'
  OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 12 AND 128
  OR p_idempotency_key !~ '^[A-Za-z0-9:_-]+$'
  OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_FINANCIAL_ADJUSTMENT',ERRCODE='22023';
 END IF;
 IF (p_action='adjust-wallet' AND (p_asset IS NULL OR p_asset NOT IN ('CASH','GOLD','HONOR')))
  OR (p_action='adjust-group-points' AND p_asset IS NOT NULL) THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_FINANCIAL_ADJUSTMENT',ERRCODE='22023';
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
 SELECT * INTO v_existing FROM public."AdminAuditLog" WHERE "idempotencyKey"=p_idempotency_key;
 IF FOUND THEN
  IF v_existing."actorTelegramId"=p_actor_telegram_id
   AND v_existing.action=p_action AND v_existing."targetId"=p_target_id
   AND v_existing.reason=btrim(p_reason)
   AND v_existing.metadata->>'amount'=p_amount::text
   AND v_existing.metadata->>'asset' IS NOT DISTINCT FROM p_asset THEN
   RETURN jsonb_build_object('ok',true,'targetType',v_existing."targetType",
    'targetId',v_existing."targetId",'replay',true,
    'balance',v_existing.metadata->>'balance','points',v_existing.metadata->>'points',
    'ledgerId',v_existing.metadata->>'ledgerId');
  END IF;
  RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_CONFLICT',ERRCODE='P0001';
 END IF;

 v_abs_amount:=abs(p_amount);
 IF p_action='adjust-wallet' THEN
  SELECT * INTO v_user FROM public."User" WHERE id=p_target_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='TARGET_NOT_FOUND',ERRCODE='P0002'; END IF;
  v_asset:=p_asset::public."WalletAsset";
  INSERT INTO public."Wallet"(id,"userId",asset,balance,version,"createdAt","updatedAt")
   VALUES(gen_random_uuid()::text,p_target_id,v_asset,0,0,clock_timestamp(),clock_timestamp())
   ON CONFLICT ("userId",asset) DO NOTHING;
  v_direction:=CASE WHEN p_amount>0 THEN 'CREDIT'::public."LedgerDirection" ELSE 'DEBIT'::public."LedgerDirection" END;
  SELECT * INTO v_wallet FROM public.apply_wallet_entry(
   p_target_id,v_asset,v_direction,v_abs_amount,p_idempotency_key,
   'ADMIN_ADJUSTMENT: '||btrim(p_reason),'ADMIN',p_idempotency_key
  );
  v_target_type:='wallet'; v_balance:=v_wallet.balance; v_ledger_id:=v_wallet.ledger_id;
 ELSE
  SELECT * INTO v_group FROM public."TelegramGroup" WHERE id=p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='TARGET_NOT_FOUND',ERRCODE='P0002'; END IF;
  IF p_amount<0 AND v_group.points<v_abs_amount THEN
   RAISE EXCEPTION USING MESSAGE='INSUFFICIENT_GROUP_POINTS',ERRCODE='P0001';
  END IF;
  IF p_amount>0 AND v_group.points>9223372036854775807-p_amount THEN
   RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_FINANCIAL_ADJUSTMENT',ERRCODE='22023';
  END IF;
  UPDATE public."TelegramGroup" SET points=points+p_amount WHERE id=p_target_id;
  INSERT INTO public."GroupPointLedger"(id,"idempotencyKey","groupId","userId",amount,source,description,"createdAt")
   VALUES(gen_random_uuid()::text,p_idempotency_key,p_target_id,NULL,p_amount,
    'ADMIN_ADJUSTMENT',btrim(p_reason),clock_timestamp())
   RETURNING id INTO v_ledger_id;
  SELECT points::text INTO v_points FROM public."TelegramGroup" WHERE id=p_target_id;
  v_target_type:='group-points';
 END IF;

 INSERT INTO public."AdminAuditLog"(id,"actorTelegramId",action,"targetType","targetId",reason,metadata,"idempotencyKey","createdAt")
 VALUES(gen_random_uuid()::text,p_actor_telegram_id,p_action,v_target_type,p_target_id,btrim(p_reason),
  jsonb_build_object('amount',p_amount::text,'asset',p_asset,'balance',v_balance,'points',v_points,'ledgerId',v_ledger_id),
  p_idempotency_key,clock_timestamp());
 RETURN jsonb_build_object('ok',true,'targetType',v_target_type,'targetId',p_target_id,
  'replay',false,'balance',v_balance,'points',v_points,'ledgerId',v_ledger_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_financial_adjustment_http(text,text,bigint,text,text,text,text) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.admin_financial_adjustment_http(text,text,bigint,text,text,text,text) TO service_role;
 END IF;
END;
$grant$;
