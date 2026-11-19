BEGIN;
SET LOCAL TIME ZONE 'Pacific/Honolulu';
DO $test$
DECLARE
 u text[]:=ARRAY['ci-event-user-1','ci-event-user-2','ci-event-user-3','ci-event-user-4'];
 c text[]:=ARRAY['ci-event-club-1','ci-event-club-2','ci-event-club-3','ci-event-club-4'];
 comp text:='ci-event-comp';tour text:='ci-event-tournament';sp text:='ci-event-special-player';r jsonb;before_cash bigint;before_gold bigint;before_item integer;
 n integer;now_at timestamptz:='2026-11-19T12:34:56.789Z'::timestamptz;
BEGIN
 INSERT INTO public."User"(id,"telegramId","updatedAt")
 SELECT u[i],'ci-event-tg-'||i,now_at AT TIME ZONE 'UTC' FROM generate_subscripts(u,1)i ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt")
 SELECT c[i],u[i],'CI Event Club '||i,'ci-event-club-'||i,now_at AT TIME ZONE 'UTC' FROM generate_subscripts(c,1)i ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."Competition"(id,"idempotencyKey",name,season,format,status,"maxTeams","cupLegs","createdByClubId","completedAt","updatedAt")
 VALUES(comp,'ci-event-comp-key-0001','CI Event Competition',2026,'LEAGUE','COMPLETED',4,1,c[1],now_at AT TIME ZONE 'UTC',now_at AT TIME ZONE 'UTC')
 ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."CompetitionEntry"(id,"competitionId","clubId",points,"goalsFor","goalsAgainst","joinedAt")
 SELECT 'ci-event-entry-'||i,comp,c[i],10-i,20-i,0,now_at AT TIME ZONE 'UTC' FROM generate_series(1,4)i ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."EventTournament"(id,"idempotencyKey",title,description,status,"maxParticipants","registrationEndsAt","startsAt","createdByTelegramId","competitionId","createdAt","updatedAt")
 VALUES(tour,'ci-event-tour-key-0001','CI Event Tournament','integration test','ACTIVE',4,now_at,now_at,'ci-event-admin',comp,now_at AT TIME ZONE 'UTC',now_at AT TIME ZONE 'UTC')
 ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."EventTournamentParticipant"(id,"tournamentId","userId","clubId","joinedAt")
 SELECT 'ci-event-part-'||i,tour,u[i],c[i],now_at AT TIME ZONE 'UTC' FROM generate_series(1,4)i ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."SpecialPlayer"(id,slug,"fullName",nationality,"birthDate",positions,overall,potential,attributes,active,"updatedAt")
 VALUES(sp,'ci-event-special','CI Special Legend','IR','1990-01-01',ARRAY['ST','RW'],90,92,'{"pace":90}'::jsonb,true,now_at AT TIME ZONE 'UTC')
 ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."EventTournamentPrize"(id,"tournamentId",placement,type,amount,"itemKey","specialPlayerId","createdAt")
 VALUES
 ('ci-event-prize-cash',tour,1,'CASH',100,NULL,NULL,now_at AT TIME ZONE 'UTC'),
 ('ci-event-prize-gold',tour,1,'GOLD',20,NULL,NULL,now_at AT TIME ZONE 'UTC'),
 ('ci-event-prize-item',tour,1,'STORE_ITEM',0,'event-boost',NULL,now_at AT TIME ZONE 'UTC'),
 ('ci-event-prize-special',tour,1,'SPECIAL_PLAYER',0,NULL,sp,now_at AT TIME ZONE 'UTC'),
 ('ci-event-prize-honor',tour,0,'HONOR',5,NULL,NULL,now_at AT TIME ZONE 'UTC')
 ON CONFLICT(id) DO NOTHING;
 r:=public.finalize_event_tournament_http(comp,now_at);
 IF r->>'finalized'<>'true' OR (r->>'participants')::integer<>4 OR (r->>'awards')::integer<>5 THEN
  RAISE EXCEPTION 'event tournament finalization mismatch: %',r; END IF;
 IF (SELECT status::text FROM public."EventTournament" WHERE id=tour)<>'COMPLETED'
  OR (SELECT count(*) FROM public."EventTournamentParticipant" WHERE "tournamentId"=tour AND "prizeSettledAt" IS NOT NULL)<>4
  OR (SELECT count(*) FROM public."LeagueNotice" WHERE "dedupeKey" LIKE 'event-tournament-result:'||tour||':%')<>4
 THEN RAISE EXCEPTION 'event tournament status, participant settlement or notices missing'; END IF;
 IF (SELECT balance FROM public."Wallet" WHERE "userId"=u[1] AND asset='CASH')<>100
  OR (SELECT balance FROM public."Wallet" WHERE "userId"=u[1] AND asset='GOLD')<>20
  OR (SELECT balance FROM public."Wallet" WHERE "userId"=u[4] AND asset='HONOR')<>5
  OR (SELECT quantity FROM public."StoreInventoryItem" WHERE "userId"=u[1] AND "itemKey"='event-boost')<>1
  OR (SELECT count(*) FROM public."Player" WHERE "clubId"=c[1] AND "specialPlayerId"=sp)<>1
  OR (SELECT count(*) FROM public."SpecialPlayerAcquisition" WHERE "idempotencyKey" LIKE 'event-tournament-special:'||tour||':%')<>1
 THEN RAISE EXCEPTION 'event tournament prize delivery mismatch'; END IF;
 r:=public.finalize_event_tournament_http(comp,now_at+interval '1 hour');
 IF r->>'replayed'<>'true' OR (SELECT balance FROM public."Wallet" WHERE "userId"=u[1] AND asset='CASH')<>100
  OR (SELECT quantity FROM public."StoreInventoryItem" WHERE "userId"=u[1] AND "itemKey"='event-boost')<>1
 THEN RAISE EXCEPTION 'event tournament replay duplicated a prize: %',r; END IF;
 r:=public.process_due_event_tournament_finalizations_http(now_at+interval '1 hour',10);
 IF (r->>'candidates')::integer<>0 THEN RAISE EXCEPTION 'completed event tournament was retried: %',r; END IF;
END;
$test$;
ROLLBACK;
