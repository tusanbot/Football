BEGIN;
SET LOCAL TIME ZONE 'Pacific/Honolulu';
DO $test$
DECLARE r jsonb;r2 jsonb;tournament_id text;created_count integer;now_at timestamptz:='2026-11-20T12:34:56.789Z';
 prizes jsonb:='[{"placement":1,"type":"HONOR","amount":"100","itemKey":null,"specialPlayerId":null}]'::jsonb;
BEGIN
 r:=public.create_event_tournament_http('ci-event-create-admin','event-tournament-create:ci-create-key-0001',
  'CI Create Cup','Atomic create integration test',NULL,0,4,now_at+interval '1 day',now_at+interval '2 days',NULL,prizes,now_at);
 IF r->>'replayed'<>'false' OR r#>>'{tournament,status}'<>'REGISTRATION' THEN RAISE EXCEPTION 'create result invalid: %',r; END IF;
 tournament_id:=r#>>'{tournament,id}';
 SELECT count(*) INTO created_count FROM public."EventTournamentPrize" WHERE "tournamentId"=tournament_id;
 IF created_count<>1 OR (SELECT count(*) FROM public."AdminAuditLog" WHERE "targetId"=tournament_id AND action='create-event-tournament')<>1
 THEN RAISE EXCEPTION 'prize or audit rows missing'; END IF;
 r2:=public.create_event_tournament_http('ci-event-create-admin','event-tournament-create:ci-create-key-0001',
  'CI Create Cup','Atomic create integration test',NULL,0,4,now_at+interval '1 day',now_at+interval '2 days',NULL,prizes,now_at+interval '1 minute');
 IF r2->>'replayed'<>'true' OR r2#>>'{tournament,id}'<>tournament_id
  OR (SELECT count(*) FROM public."EventTournamentPrize" WHERE "tournamentId"=tournament_id)<>1
  OR (SELECT count(*) FROM public."AdminAuditLog" WHERE "targetId"=tournament_id AND action='create-event-tournament')<>1
 THEN RAISE EXCEPTION 'idempotent create replay mismatch: %',r2; END IF;
 BEGIN
  PERFORM public.create_event_tournament_http('ci-event-create-admin','event-tournament-create:ci-create-key-0001',
   'Different Cup','Atomic create integration test',NULL,0,4,now_at+interval '1 day',now_at+interval '2 days',NULL,prizes,now_at);
  RAISE EXCEPTION 'idempotency conflict was not rejected';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM<>'IDEMPOTENCY_CONFLICT' THEN RAISE; END IF;
 END;
END;
$test$;
ROLLBACK;
