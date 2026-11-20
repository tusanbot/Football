BEGIN;
DO $test$
DECLARE
 v jsonb; v_message text; v_balance bigint; v_points bigint; v_count bigint;
BEGIN
 INSERT INTO public."User"(id,"telegramId","updatedAt") VALUES('ci-admin-fin-user','919900097001',clock_timestamp());
 INSERT INTO public."TelegramGroup"(id,"telegramId",title,points,"isActive")
 VALUES('ci-admin-fin-group','-100919900097001','CI admin finance group',100,true);
 v:=public.admin_financial_adjustment_http('adjust-wallet','ci-admin-fin-user',50,'CASH','919900097','admin-fin-wallet-key-01','Manual credit');
 IF v->>'replay'<>'false' OR v->>'balance'<>'50' THEN RAISE EXCEPTION 'wallet adjustment failed: %',v; END IF;
 v:=public.admin_financial_adjustment_http('adjust-wallet','ci-admin-fin-user',50,'CASH','919900097','admin-fin-wallet-key-01','Manual credit');
 IF v->>'replay'<>'true' OR v->>'balance'<>'50' THEN RAISE EXCEPTION 'wallet replay failed: %',v; END IF;
 BEGIN
  PERFORM public.admin_financial_adjustment_http('adjust-wallet','ci-admin-fin-user',51,'CASH','919900097','admin-fin-wallet-key-01','Manual credit');
  RAISE EXCEPTION 'expected wallet idempotency conflict';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT; IF v_message<>'IDEMPOTENCY_CONFLICT' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.admin_financial_adjustment_http('adjust-wallet','ci-admin-fin-user',-100,'CASH','919900097','admin-fin-wallet-key-02','Manual debit');
  RAISE EXCEPTION 'expected insufficient wallet balance';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT; IF v_message<>'INSUFFICIENT_FUNDS' THEN RAISE; END IF;
 END;
 SELECT balance INTO v_balance FROM public."Wallet" WHERE "userId"='ci-admin-fin-user' AND asset='CASH';
 SELECT count(*) INTO v_count FROM public."LedgerTransaction" WHERE "userId"='ci-admin-fin-user';
 IF v_balance<>50 OR v_count<>1 THEN RAISE EXCEPTION 'failed wallet adjustment mutated ledger or balance'; END IF;

 v:=public.admin_financial_adjustment_http('adjust-group-points','ci-admin-fin-group',25,NULL,'919900097','admin-fin-group-key-01','Manual points credit');
 IF v->>'replay'<>'false' OR v->>'points'<>'125' THEN RAISE EXCEPTION 'group points credit failed: %',v; END IF;
 v:=public.admin_financial_adjustment_http('adjust-group-points','ci-admin-fin-group',25,NULL,'919900097','admin-fin-group-key-01','Manual points credit');
 IF v->>'replay'<>'true' OR v->>'points'<>'125' THEN RAISE EXCEPTION 'group points replay failed: %',v; END IF;
 BEGIN
  PERFORM public.admin_financial_adjustment_http('adjust-group-points','ci-admin-fin-group',-200,NULL,'919900097','admin-fin-group-key-02','Manual points debit');
  RAISE EXCEPTION 'expected insufficient group points';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT; IF v_message<>'INSUFFICIENT_GROUP_POINTS' THEN RAISE; END IF;
 END;
 SELECT points INTO v_points FROM public."TelegramGroup" WHERE id='ci-admin-fin-group';
 SELECT count(*) INTO v_count FROM public."GroupPointLedger" WHERE "groupId"='ci-admin-fin-group';
 IF v_points<>125 OR v_count<>1 THEN RAISE EXCEPTION 'failed group points adjustment mutated ledger or balance'; END IF;
 IF (SELECT count(*) FROM public."AdminAuditLog" WHERE "actorTelegramId"='919900097')<>2 THEN RAISE EXCEPTION 'admin finance audit rows missing'; END IF;
 IF NOT has_function_privilege('service_role','public.admin_financial_adjustment_http(text,text,bigint,text,text,text,text)','EXECUTE')
  OR has_function_privilege('anon','public.admin_financial_adjustment_http(text,text,bigint,text,text,text,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.admin_financial_adjustment_http(text,text,bigint,text,text,text,text)','EXECUTE') THEN
  RAISE EXCEPTION 'admin financial adjustment RPC exposed to public roles';
 END IF;
END;
$test$;
ROLLBACK;
