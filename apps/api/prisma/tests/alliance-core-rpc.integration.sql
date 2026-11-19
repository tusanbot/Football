BEGIN;
DO $test$
DECLARE
 v_a text:=gen_random_uuid()::text; v_b text:=gen_random_uuid()::text;
 v_ta text:=(100000000000+floor(random()*899999999999)::bigint)::text;
 v_tb text:=(100000000000+floor(random()*899999999999)::bigint)::text;
 v_ga text:='-100'||(100000000000+floor(random()*899999999999)::bigint)::text;
 v_gb text:='-100'||(100000000000+floor(random()*899999999999)::bigint)::text;
 v_now timestamptz:=clock_timestamp(); r jsonb; aid text; iid text;
BEGIN
 INSERT INTO public."User"(id,"telegramId","displayName","createdAt","updatedAt","lastActiveAt") VALUES(v_a,v_ta,'Alliance Founder',v_now,v_now,v_now),(v_b,v_tb,'Alliance Invitee',v_now,v_now,v_now);
 INSERT INTO public."Club"(id,"ownerId",name,slug,"createdAt","updatedAt") VALUES(gen_random_uuid()::text,v_a,'Alliance Founder FC','alliance-founder-'||v_a,v_now,v_now),(gen_random_uuid()::text,v_b,'Alliance Invitee FC','alliance-invitee-'||v_b,v_now,v_now);
 r:=public.register_telegram_group_http(v_ta,v_ga,'Alliance Founder Group','OWNER',20,v_now);
 IF r->>'role'<>'OWNER' THEN RAISE EXCEPTION 'founder group registration failed: %',r; END IF;
 r:=public.register_telegram_group_http(v_tb,v_gb,'Alliance Invitee Group','OWNER',20,v_now);
 IF r->>'role'<>'OWNER' THEN RAISE EXCEPTION 'invitee group registration failed: %',r; END IF;
 UPDATE public."TelegramGroup" SET points=500 WHERE "telegramId"=v_ga;
 r:=public.create_alliance_http(v_ta,v_ga,'RPC Test Alliance','atomic alliance test','alliance-rpc-test-0001');
 IF r->>'replayed'<>'false' OR r#>>'{alliance,name}'<>'RPC Test Alliance' THEN RAISE EXCEPTION 'alliance creation failed: %',r; END IF;
 aid:=r#>>'{alliance,id}';
 r:=public.create_alliance_http(v_ta,v_ga,'RPC Test Alliance','atomic alliance test','alliance-rpc-test-0001');
 IF r->>'replayed'<>'true' THEN RAISE EXCEPTION 'alliance create replay failed: %',r; END IF;
 r:=public.invite_alliance_group_http(v_ta,v_ga,v_gb); iid:=r#>>'{invitation,id}';
 IF iid IS NULL OR r#>>'{alliance,id}'<>aid THEN RAISE EXCEPTION 'alliance invite failed: %',r; END IF;
 r:=public.respond_alliance_invitation_http(v_tb,v_gb,iid,true);
 IF r->>'accepted'<>'true' OR r->>'replayed'<>'false' THEN RAISE EXCEPTION 'invitation acceptance failed: %',r; END IF;
 r:=public.respond_alliance_invitation_http(v_tb,v_gb,iid,true);
 IF r->>'accepted'<>'true' OR r->>'replayed'<>'true' THEN RAISE EXCEPTION 'invitation replay failed: %',r; END IF;
 r:=public.contribute_alliance_treasury_http(v_ta,v_ga,100,'alliance-contrib-rpc-0001');
 IF r->>'contributed'<>'true' OR r->>'replayed'<>'false' OR r->>'treasuryPoints'<>'100' OR r->>'groupPoints'<>'400' THEN RAISE EXCEPTION 'contribution failed: %',r; END IF;
 r:=public.contribute_alliance_treasury_http(v_ta,v_ga,100,'alliance-contrib-rpc-0001');
 IF r->>'replayed'<>'true' OR r->>'treasuryPoints'<>'100' THEN RAISE EXCEPTION 'contribution replay failed: %',r; END IF;
 r:=public.contribute_alliance_treasury_http(v_ta,v_ga,101,'alliance-contrib-rpc-0001');
 IF r->>'error'<>'IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'contribution conflict failed: %',r; END IF;
 IF (SELECT count(*) FROM public."AllianceLedger" WHERE "allianceId"=aid AND source='GROUP_CONTRIBUTION')<>1 THEN RAISE EXCEPTION 'alliance ledger was not idempotent'; END IF;
 IF (SELECT count(*) FROM public."AllianceGroup" WHERE "allianceId"=aid)<>2 THEN RAISE EXCEPTION 'alliance membership count mismatch'; END IF;
END $test$;
ROLLBACK;
