-- Atomic tournament registration, wallet debit, idempotency and automatic fixture creation.
BEGIN;
SET LOCAL TIME ZONE 'Pacific/Auckland';
DO $test$
DECLARE
 v_now timestamptz:='2026-11-20T12:34:56.789Z';
 v_users text[]:=ARRAY['900000001','900000002','900000003','900000004'];
 v_user_ids text[]:=ARRAY['ci-event-join-user-1','ci-event-join-user-2','ci-event-join-user-3','ci-event-join-user-4'];
 v_clubs text[]:=ARRAY['ci-event-join-club-1','ci-event-join-club-2','ci-event-join-club-3','ci-event-join-club-4'];
 v_result jsonb;v_replay jsonb;v_tournament_id text:='ci-event-join-tournament';
 v_competition_id text;v_participant_id text;v_balance bigint;v_count integer;v_message text;
 i integer;n integer;v_position text;v_positions text[]:=ARRAY['GK','RB','CB','CB','LB','CDM','CM','CM','RW','LW','ST'];
BEGIN
 FOR i IN 1..4 LOOP
  INSERT INTO public."User"(id,"telegramId","updatedAt")
  VALUES(v_user_ids[i],v_users[i],v_now AT TIME ZONE 'UTC');
  INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt")
  VALUES(v_clubs[i],v_user_ids[i],'CI Tournament Club '||i,'ci-event-join-club-'||i,v_now AT TIME ZONE 'UTC');
  INSERT INTO public."Wallet"(id,"userId",asset,balance,version,"createdAt","updatedAt")
  VALUES('ci-event-join-wallet-'||i,v_user_ids[i],'CASH',1000,0,v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC');
  FOR n IN 1..11 LOOP
   INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,
    attributes,wage,"contractDays","createdAt","updatedAt")
   VALUES('ci-event-join-player-'||i||'-'||n,v_clubs[i],'Player',''||n,'US',22,
    v_positions[n]::"PlayerPosition",60,70,'{}'::jsonb,10,365,v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC');
  END LOOP;
 END LOOP;
 INSERT INTO public."EventTournament"(id,"idempotencyKey",title,description,status,"entryFeeAsset","entryFeeAmount",
  "maxParticipants","registrationEndsAt","startsAt","createdByTelegramId","createdAt","updatedAt")
 VALUES(v_tournament_id,'ci-event-join-idempotency','CI Join Cup','Atomic registration and kickoff test',
  'REGISTRATION','CASH',100,4,v_now+interval '1 day',v_now+interval '2 days','900000999',
  v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC');

 v_result:=public.join_event_tournament_http(v_users[1],v_tournament_id,v_now);
 IF v_result->>'replayed' IS DISTINCT FROM 'false' OR v_result->>'autoStarted' IS DISTINCT FROM 'false'
  OR v_result->>'participantCount' IS DISTINCT FROM '1' OR v_result->>'requiredParticipants' IS DISTINCT FROM '4' THEN
  RAISE EXCEPTION 'first tournament join response mismatch: %',v_result;
 END IF;
 v_participant_id:=v_result->>'participantId';
 SELECT balance INTO v_balance FROM public."Wallet" WHERE "userId"=v_user_ids[1] AND asset='CASH';
 IF v_balance<>900 OR (SELECT count(*) FROM public."LedgerTransaction"
  WHERE "idempotencyKey"='event-tournament-entry:'||v_tournament_id||':'||v_user_ids[1])<>1 THEN
  RAISE EXCEPTION 'entry fee was not debited and ledgered exactly once';
 END IF;
 v_replay:=public.join_event_tournament_http(v_users[1],v_tournament_id,v_now+interval '1 minute');
 IF v_replay->>'replayed' IS DISTINCT FROM 'true' OR v_replay->>'participantId'<>v_participant_id THEN
  RAISE EXCEPTION 'join replay did not return the original participant: %',v_replay;
 END IF;
 SELECT balance INTO v_balance FROM public."Wallet" WHERE "userId"=v_user_ids[1] AND asset='CASH';
 IF v_balance<>900 OR (SELECT count(*) FROM public."EventTournamentParticipant" WHERE "tournamentId"=v_tournament_id AND "userId"=v_user_ids[1])<>1 THEN
  RAISE EXCEPTION 'idempotent join charged or registered the same user twice';
 END IF;

 PERFORM public.join_event_tournament_http(v_users[2],v_tournament_id,v_now);
 PERFORM public.join_event_tournament_http(v_users[3],v_tournament_id,v_now);
 v_result:=public.join_event_tournament_http(v_users[4],v_tournament_id,v_now);
 IF v_result->>'autoStarted' IS DISTINCT FROM 'true' OR v_result->>'participantCount' IS DISTINCT FROM '4'
  OR v_result->>'fixturesCreated' IS DISTINCT FROM '6' OR v_result->>'rounds' IS DISTINCT FROM '3'
  OR COALESCE(v_result->>'competitionId','')='' THEN
  RAISE EXCEPTION 'tournament did not auto-start with a complete round robin: %',v_result;
 END IF;
 v_competition_id:=v_result->>'competitionId';
 IF (SELECT status::text FROM public."EventTournament" WHERE id=v_tournament_id)<>'ACTIVE'
  OR (SELECT "competitionId" FROM public."EventTournament" WHERE id=v_tournament_id)<>v_competition_id
  OR (SELECT status::text FROM public."Competition" WHERE id=v_competition_id)<>'ACTIVE'
  OR (SELECT count(*) FROM public."CompetitionEntry" WHERE "competitionId"=v_competition_id)<>4
  OR (SELECT count(*) FROM public."FootballMatch" WHERE "competitionId"=v_competition_id)<>6
  OR (SELECT count(*) FROM public."EventTournamentParticipant" WHERE "tournamentId"=v_tournament_id)<>4 THEN
  RAISE EXCEPTION 'tournament competition, entries or fixtures were not created atomically';
 END IF;
 FOR i IN 1..4 LOOP
  SELECT balance INTO v_balance FROM public."Wallet" WHERE "userId"=v_user_ids[i] AND asset='CASH';
  IF v_balance<>900 THEN RAISE EXCEPTION 'entry fee mismatch for participant %: %',i,v_balance; END IF;
 END LOOP;
 IF (SELECT count(*) FROM public."LedgerTransaction" WHERE "referenceType"='event-tournament' AND "referenceId"=v_tournament_id AND reason='EVENT_TOURNAMENT_ENTRY')<>4 THEN
  RAISE EXCEPTION 'expected exactly four entry-fee ledger rows';
 END IF;

 INSERT INTO public."User"(id,"telegramId","updatedAt") VALUES('ci-event-join-poor-user','900000005',v_now AT TIME ZONE 'UTC');
 INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt") VALUES('ci-event-join-poor-club','ci-event-join-poor-user','CI Poor Club','ci-event-join-poor-club',v_now AT TIME ZONE 'UTC');
 INSERT INTO public."Wallet"(id,"userId",asset,balance,version,"createdAt","updatedAt")
 VALUES('ci-event-join-poor-wallet','ci-event-join-poor-user','CASH',50,0,v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC');
 INSERT INTO public."EventTournament"(id,"idempotencyKey",title,description,status,"entryFeeAsset","entryFeeAmount",
  "maxParticipants","registrationEndsAt","startsAt","createdByTelegramId","createdAt","updatedAt")
 VALUES('ci-event-join-poor-tournament','ci-event-join-poor-key','CI Poor Cup','Insufficient balance test',
  'REGISTRATION','CASH',100,4,v_now+interval '1 day',v_now+interval '2 days','900000999',
  v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC');
 v_message:=NULL;
 BEGIN
  PERFORM public.join_event_tournament_http('900000005','ci-event-join-poor-tournament',v_now);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
 END;
 IF v_message IS DISTINCT FROM 'INSUFFICIENT_FUNDS'
  OR (SELECT balance FROM public."Wallet" WHERE id='ci-event-join-poor-wallet')<>50
  OR EXISTS(SELECT 1 FROM public."EventTournamentParticipant" WHERE "tournamentId"='ci-event-join-poor-tournament')
  OR EXISTS(SELECT 1 FROM public."LedgerTransaction" WHERE "idempotencyKey"='event-tournament-entry:ci-event-join-poor-tournament:ci-event-join-poor-user') THEN
  RAISE EXCEPTION 'insufficient-funds join did not roll back cleanly (error=%)',v_message;
 END IF;
END;
$test$;
ROLLBACK;
