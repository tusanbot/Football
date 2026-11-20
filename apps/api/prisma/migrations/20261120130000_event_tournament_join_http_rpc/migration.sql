-- Atomic event tournament registration, entry-fee debit and automatic league kickoff.
CREATE OR REPLACE FUNCTION public.join_event_tournament_http(
 p_telegram_user_id text,p_tournament_id text,p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp
AS $fn$
DECLARE
 v_user public."User"%ROWTYPE;v_tournament public."EventTournament"%ROWTYPE;
 v_club_id text;v_participant public."EventTournamentParticipant"%ROWTYPE;
 v_count integer;v_wallet public."Wallet"%ROWTYPE;v_ledger_id text;
 v_slots text[];v_slot_count integer;v_rounds integer;v_round integer;v_pair integer;
 v_first text;v_second text;v_home text;v_away text;v_swap text;v_last text;
 v_comp public."Competition"%ROWTYPE;v_comp_id text;v_kickoff timestamptz;
 v_fixture_key text;v_fixtures integer:=0;v_rules jsonb:='{"maxSubstitutions":5,"maxInPlayWindows":3,"injuriesEnabled":true,"injuryDurationDays":5,"redCardSuspensionMatches":1,"yellowCardsToSuspend":3,"yellowCardSuspensionMatches":1,"penaltiesOnDraw":false}'::jsonb;
BEGIN
 IF p_telegram_user_id IS NULL OR p_telegram_user_id !~ '^[0-9]{1,20}$'
  OR p_tournament_id IS NULL OR btrim(p_tournament_id)='' OR p_now IS NULL THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_TOURNAMENT_JOIN',ERRCODE='22023';
 END IF;
 SELECT * INTO v_user FROM public."User" WHERE "telegramId"=p_telegram_user_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='ACCOUNT_NOT_FOUND',ERRCODE='P0001'; END IF;
 IF v_user."isSuspended" THEN RAISE EXCEPTION USING MESSAGE='ACCOUNT_SUSPENDED',ERRCODE='P0001'; END IF;
 SELECT * INTO v_tournament FROM public."EventTournament" WHERE id=p_tournament_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='TOURNAMENT_NOT_FOUND',ERRCODE='P0001'; END IF;
 SELECT id INTO v_club_id FROM public."Club" WHERE "ownerId"=v_user.id LIMIT 1;
 IF v_club_id IS NULL THEN RAISE EXCEPTION USING MESSAGE='CLUB_NOT_FOUND',ERRCODE='P0001'; END IF;
 SELECT * INTO v_participant FROM public."EventTournamentParticipant"
 WHERE "tournamentId"=v_tournament.id AND "userId"=v_user.id;
 IF FOUND THEN
  RETURN jsonb_build_object('participantId',v_participant.id,'replayed',true,'autoStarted',false);
 END IF;
 IF EXISTS(SELECT 1 FROM public."EventTournamentParticipant"
  WHERE "tournamentId"=v_tournament.id AND "clubId"=v_club_id) THEN
  RAISE EXCEPTION USING MESSAGE='TOURNAMENT_CLUB_ALREADY_REGISTERED',ERRCODE='P0001';
 END IF;
 IF v_tournament.status::text<>'REGISTRATION'
  OR v_tournament."registrationEndsAt"<=p_now AT TIME ZONE 'UTC'
  OR v_tournament."startsAt"<=p_now AT TIME ZONE 'UTC' THEN
  RAISE EXCEPTION USING MESSAGE='TOURNAMENT_REGISTRATION_CLOSED',ERRCODE='P0001';
 END IF;
 SELECT count(*)::integer INTO v_count FROM public."EventTournamentParticipant" WHERE "tournamentId"=v_tournament.id;
 IF v_count>=v_tournament."maxParticipants" THEN RAISE EXCEPTION USING MESSAGE='TOURNAMENT_FULL',ERRCODE='P0001'; END IF;
 IF v_tournament."entryFeeAmount"<0 OR (v_tournament."entryFeeAmount">0 AND v_tournament."entryFeeAsset" IS NULL) THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_TOURNAMENT_ENTRY_FEE',ERRCODE='P0001';
 END IF;
 IF v_tournament."entryFeeAmount">0 THEN
  SELECT * INTO v_wallet FROM public."Wallet"
  WHERE "userId"=v_user.id AND asset=v_tournament."entryFeeAsset" FOR UPDATE;
  IF NOT FOUND OR v_wallet.balance<v_tournament."entryFeeAmount" THEN
   RAISE EXCEPTION USING MESSAGE='INSUFFICIENT_FUNDS',ERRCODE='P0001';
  END IF;
  IF v_wallet.version>=2147483647 THEN RAISE EXCEPTION USING MESSAGE='CONCURRENT_MODIFICATION',ERRCODE='P0001'; END IF;
  UPDATE public."Wallet" SET balance=balance-v_tournament."entryFeeAmount",
   version=version+1,"updatedAt"=p_now AT TIME ZONE 'UTC'
  WHERE id=v_wallet.id AND balance=v_wallet.balance AND version=v_wallet.version;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='CONCURRENT_MODIFICATION',ERRCODE='P0001'; END IF;
  INSERT INTO public."LedgerTransaction"(id,"idempotencyKey","userId",asset,direction,amount,reason,"referenceType","referenceId","createdAt")
  VALUES('ledger_'||replace(gen_random_uuid()::text,'-',''),
   'event-tournament-entry:'||v_tournament.id||':'||v_user.id,v_user.id,
   v_tournament."entryFeeAsset",'DEBIT',v_tournament."entryFeeAmount",
   'EVENT_TOURNAMENT_ENTRY','event-tournament',v_tournament.id,p_now AT TIME ZONE 'UTC')
  ON CONFLICT("idempotencyKey") DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_CONFLICT',ERRCODE='P0001'; END IF;
 END IF;
 INSERT INTO public."EventTournamentParticipant"(id,"tournamentId","userId","clubId","joinedAt")
 VALUES('event_tournament_participant_'||replace(gen_random_uuid()::text,'-',''),
  v_tournament.id,v_user.id,v_club_id,p_now AT TIME ZONE 'UTC')
 RETURNING * INTO v_participant;
 v_count:=v_count+1;
 IF v_count<v_tournament."maxParticipants" THEN
  RETURN jsonb_build_object('participantId',v_participant.id,'replayed',false,
   'autoStarted',false,'participantCount',v_count,'requiredParticipants',v_tournament."maxParticipants");
 END IF;
 SELECT array_agg(p."clubId" ORDER BY p."joinedAt",p.id) INTO v_slots
 FROM public."EventTournamentParticipant" p WHERE p."tournamentId"=v_tournament.id;
 IF COALESCE(array_length(v_slots,1),0)<>v_tournament."maxParticipants" THEN
  RAISE EXCEPTION USING MESSAGE='TOURNAMENT_CAPACITY_CHANGED',ERRCODE='P0001';
 END IF;
 IF v_tournament."maxParticipants" NOT BETWEEN 4 AND 16 THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_TOURNAMENT_CAPACITY',ERRCODE='P0001';
 END IF;
 IF EXISTS(
  SELECT 1 FROM public."EventTournamentParticipant" p
  WHERE p."tournamentId"=v_tournament.id AND (
   (SELECT count(*) FROM public."Player" pl
    WHERE pl."clubId"=p."clubId" AND pl.status::text='ACTIVE')<11
   OR NOT EXISTS(SELECT 1 FROM public."Player" pl
    WHERE pl."clubId"=p."clubId" AND pl.status::text='ACTIVE' AND pl.position::text='GK')
  )
 ) THEN RAISE EXCEPTION USING MESSAGE='ALL_TEAMS_NEED_VALID_LINEUPS',ERRCODE='P0001'; END IF;
 SELECT p."clubId" INTO v_club_id FROM public."EventTournamentParticipant" p
 WHERE p."tournamentId"=v_tournament.id ORDER BY p."joinedAt",p.id LIMIT 1;
 v_kickoff:=p_now+interval '1 day';
 v_comp_id:='event_tournament_comp_'||replace(gen_random_uuid()::text,'-','');
 INSERT INTO public."Competition"(id,"idempotencyKey",name,season,format,status,"maxTeams","cupLegs",rules,
  "createdByClubId","startsAt","createdAt","updatedAt")
 VALUES(v_comp_id,'event-tournament-competition:'||v_tournament.id,v_tournament.title,
  extract(year FROM (p_now AT TIME ZONE 'UTC'))::integer,'LEAGUE','ACTIVE',
  v_tournament."maxParticipants",1,v_rules,v_club_id,v_kickoff AT TIME ZONE 'UTC',
  p_now AT TIME ZONE 'UTC',p_now AT TIME ZONE 'UTC')
 RETURNING * INTO v_comp;
 INSERT INTO public."CompetitionEntry"(id,"competitionId","clubId","joinedAt")
 SELECT 'competition_entry_'||replace(gen_random_uuid()::text,'-',''),v_comp.id,p."clubId",p."joinedAt"
 FROM public."EventTournamentParticipant" p WHERE p."tournamentId"=v_tournament.id;
 -- Shuffle once, then use the circle method for a complete round-robin schedule.
 FOR v_round IN REVERSE array_length(v_slots,1)..2 LOOP
  v_pair:=floor(random()*v_round)::integer+1;
  v_swap:=v_slots[v_round];v_slots[v_round]:=v_slots[v_pair];v_slots[v_pair]:=v_swap;
 END LOOP;
 IF mod(array_length(v_slots,1),2)=1 THEN v_slots:=array_append(v_slots,NULL::text); END IF;
 v_slot_count:=array_length(v_slots,1);v_rounds:=v_slot_count-1;
 FOR v_round IN 0..v_rounds-1 LOOP
  FOR v_pair IN 1..(v_slot_count/2) LOOP
   v_first:=v_slots[v_pair];v_second:=v_slots[v_slot_count-v_pair+1];
   IF v_first IS NOT NULL AND v_second IS NOT NULL THEN
    IF mod(v_round+v_pair-1,2)=1 THEN v_home:=v_second;v_away:=v_first;
    ELSE v_home:=v_first;v_away:=v_second; END IF;
    v_fixture_key:='event-tournament:'||v_tournament.id||':r'||(v_round+1)||':'||v_home||':'||v_away;
    INSERT INTO public."FootballMatch"(id,"idempotencyKey",type,status,"homeClubId","awayClubId",
     "competitionId",round,leg,"scheduledAt",seed,"rulesSnapshot","createdAt","updatedAt")
    VALUES('event_tournament_match_'||replace(gen_random_uuid()::text,'-',''),v_fixture_key,
     'LEAGUE','SCHEDULED',v_home,v_away,v_comp.id,v_round+1,1,
     (v_kickoff+v_round*interval '1 day') AT TIME ZONE 'UTC',v_fixture_key,v_rules,
     p_now AT TIME ZONE 'UTC',p_now AT TIME ZONE 'UTC');
    v_fixtures:=v_fixtures+1;
   END IF;
  END LOOP;
  v_last:=v_slots[v_slot_count];
  v_slots:=ARRAY[v_slots[1],v_last]||v_slots[2:v_slot_count-1];
 END LOOP;
 UPDATE public."EventTournament" SET status='ACTIVE', "competitionId"=v_comp.id,
  "startsAt"=v_kickoff AT TIME ZONE 'UTC',"updatedAt"=p_now AT TIME ZONE 'UTC'
 WHERE id=v_tournament.id;
 RETURN jsonb_build_object('participantId',v_participant.id,'replayed',false,
  'autoStarted',true,'participantCount',v_count,'fixturesCreated',v_fixtures,
  'rounds',v_rounds,'startsAt',to_jsonb(v_kickoff),'competitionId',v_comp.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.join_event_tournament_http(text,text,timestamptz) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.join_event_tournament_http(text,text,timestamptz) TO service_role;
 END IF;
END;
$grant$;
