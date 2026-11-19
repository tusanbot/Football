BEGIN;
DO $test$
DECLARE r jsonb; replay jsonb;
BEGIN
 INSERT INTO public."User"(id,"telegramId","updatedAt") VALUES
 ('ci-forfeit-home-user','ci-forfeit-home-tg',now()),('ci-forfeit-away-user','ci-forfeit-away-tg',now()) ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt") VALUES
 ('ci-forfeit-home-club','ci-forfeit-home-user','CI Forfeit Home','ci-forfeit-home',now()),
 ('ci-forfeit-away-club','ci-forfeit-away-user','CI Forfeit Away','ci-forfeit-away',now()) ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,attributes,wage,"contractDays","lineupSlot","updatedAt")
 SELECT 'ci-forfeit-home-player-'||n,'ci-forfeit-home-club','Home',n::text,'IR',25,
 CASE WHEN n=11 THEN 'GK'::public."PlayerPosition" ELSE 'CB'::public."PlayerPosition" END,60,65,'{}'::jsonb,10,365,n,now()
 FROM generate_series(1,11)n ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,attributes,wage,"contractDays","lineupSlot","updatedAt")
 SELECT 'ci-forfeit-away-player-'||n,'ci-forfeit-away-club','Away',n::text,'IR',25,'CB'::public."PlayerPosition",60,65,'{}'::jsonb,10,365,n,now()
 FROM generate_series(1,10)n ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."FootballMatch"(id,"idempotencyKey","homeClubId","awayClubId","scheduledAt",seed,"updatedAt")
 VALUES('ci-forfeit-match','ci-forfeit-key','ci-forfeit-home-club','ci-forfeit-away-club',now()-interval '1 hour','ci-forfeit-seed',now())
 ON CONFLICT(id) DO NOTHING;
 r:=public.settle_invalid_match_fixture_http('ci-forfeit-match',now());
 IF r->>'settled'<>'true' OR r->>'replayed'<>'false' THEN RAISE EXCEPTION 'first forfeit settlement failed: %',r; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FootballMatch" WHERE id='ci-forfeit-match' AND status='COMPLETED'
  AND "homeScore"=3 AND "awayScore"=0 AND "winnerClubId"='ci-forfeit-home-club') THEN RAISE EXCEPTION 'forfeit result mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public."MatchRuntime" WHERE "matchId"='ci-forfeit-match') THEN RAISE EXCEPTION 'runtime unexpectedly created'; END IF;
 IF (SELECT count(*) FROM public."MatchResultNotification" WHERE "matchId"='ci-forfeit-match')<>2 THEN RAISE EXCEPTION 'result notifications missing'; END IF;
 replay:=public.settle_invalid_match_fixture_http('ci-forfeit-match',now());
 IF replay->>'replayed'<>'true' THEN RAISE EXCEPTION 'forfeit replay not idempotent'; END IF;
 IF (SELECT count(*) FROM public."LedgerTransaction" WHERE "referenceType"='FOOTBALL_MATCH' AND "referenceId"='ci-forfeit-match')<>2 THEN RAISE EXCEPTION 'reward credits duplicated or missing'; END IF;
END;$test$;
ROLLBACK;
