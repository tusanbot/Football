CREATE OR REPLACE FUNCTION public.get_admin_finance_summary_http(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE v_from timestamptz; v_wallet jsonb; v_club_finance jsonb; v_group_points jsonb;
 v_wallet_reconciliation jsonb; v_group_reconciliation jsonb; v_club_summary jsonb; v_arrears text;
BEGIN
 IF p_days IS NULL OR p_days<1 OR p_days>365 THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_FINANCE_PERIOD',ERRCODE='22023';
 END IF;
 v_from:=clock_timestamp()-make_interval(days=>p_days);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('asset',x.asset,'direction',x.direction,'total',x.total,'count',x.row_count)),'[]'::jsonb)
 INTO v_wallet FROM (
  SELECT asset::text AS asset,direction::text AS direction,COALESCE(sum(amount),0)::text AS total,count(*) AS row_count
  FROM public."LedgerTransaction" WHERE "createdAt">=v_from GROUP BY asset,direction ORDER BY asset,direction
 ) x;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('category',x.category,'direction',x.direction,'total',x.total,'count',x.row_count)),'[]'::jsonb)
 INTO v_club_finance FROM (
  SELECT category,direction::text AS direction,COALESCE(sum(amount),0)::text AS total,count(*) AS row_count
  FROM public."ClubFinanceEntry" WHERE "occurredAt">=v_from GROUP BY category,direction ORDER BY category,direction
 ) x;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('source',x.source,'total',x.total,'count',x.row_count)),'[]'::jsonb)
 INTO v_group_points FROM (
  SELECT source::text AS source,COALESCE(sum(amount),0)::text AS total,count(*) AS row_count
  FROM public."GroupPointLedger" WHERE "createdAt">=v_from GROUP BY source ORDER BY source
 ) x;
 SELECT jsonb_agg(jsonb_build_object('asset',a.asset,'walletBalance',a.balance,'ledgerNet',a.ledger_net,'difference',(a.balance::numeric-a.ledger_net::numeric)::text) ORDER BY a.asset)
 INTO v_wallet_reconciliation FROM (
  SELECT assets.asset,
   COALESCE((SELECT sum(w.balance) FROM public."Wallet" w WHERE w.asset::text=assets.asset),0)::text AS balance,
   (COALESCE((SELECT sum(l.amount) FROM public."LedgerTransaction" l WHERE l.asset::text=assets.asset AND l.direction='CREDIT'),0)
    -COALESCE((SELECT sum(l.amount) FROM public."LedgerTransaction" l WHERE l.asset::text=assets.asset AND l.direction='DEBIT'),0))::text AS ledger_net
  FROM (VALUES('CASH'),('GOLD')) assets(asset)
 ) a;
 SELECT jsonb_build_array(jsonb_build_object(
  'treasuryBalance',COALESCE((SELECT sum(points) FROM public."TelegramGroup"),0)::text,
  'ledgerNet',COALESCE((SELECT sum(amount) FROM public."GroupPointLedger"),0)::text,
  'difference',(COALESCE((SELECT sum(points) FROM public."TelegramGroup"),0)-COALESCE((SELECT sum(amount) FROM public."GroupPointLedger"),0))::text
 )) INTO v_group_reconciliation;
 SELECT jsonb_build_array(
  jsonb_build_object('metric','income', 'total',COALESCE(sum(amount) FILTER(WHERE direction='CREDIT'),0)::text),
  jsonb_build_object('metric','expenses','total',COALESCE(sum(amount) FILTER(WHERE direction='DEBIT'),0)::text),
  jsonb_build_object('metric','net','total',(COALESCE(sum(amount) FILTER(WHERE direction='CREDIT'),0)-COALESCE(sum(amount) FILTER(WHERE direction='DEBIT'),0))::text)
 ) INTO v_club_summary FROM public."ClubFinanceEntry";
 SELECT COALESCE(sum("operatingArrears"),0)::text INTO v_arrears FROM public."Club";
 RETURN jsonb_build_object('days',p_days,'from',v_from,'wallet',v_wallet,'clubFinance',v_club_finance,
  'groupPoints',v_group_points,'walletReconciliation',COALESCE(v_wallet_reconciliation,'[]'::jsonb),
  'groupReconciliation',v_group_reconciliation,'clubFinanceSummary',v_club_summary,'clubArrearsTotal',v_arrears);
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_admin_finance_summary_http(integer) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.get_admin_finance_summary_http(integer) TO service_role;
 END IF;
END;
$grant$;
