BEGIN;
SET LOCAL TIME ZONE 'Pacific/Honolulu';
DO $test$
DECLARE
 v_users text[]:=ARRAY['ci-pyr-user-1','ci-pyr-user-2','ci-pyr-user-3','ci-pyr-user-4','ci-pyr-user-5','ci-pyr-user-6','ci-pyr-user-7','ci-pyr-user-8','ci-pyr-user-9','ci-pyr-user-10','ci-pyr-user-11','ci-pyr-user-12','ci-pyr-user-13','ci-pyr-user-14'];
 v_clubs text[]:=ARRAY['ci-pyr-club-1','ci-pyr-club-2','ci-pyr-club-3','ci-pyr-club-4','ci-pyr-club-5','ci-pyr-club-6','ci-pyr-club-7','ci-pyr-club-8','ci-pyr-club-9','ci-pyr-club-10','ci-pyr-club-11','ci-pyr-club-12','ci-pyr-club-13','ci-pyr-club-14'];
 v_comp text:='ci-pyr-completed-comp';v_league text:='ci-pyr-league';v_result jsonb;v_replacement text;v_count integer;v_message text;
 v_now timestamptz:='2026-11-19T12:34:56.789Z'::timestamptz;
BEGIN
 INSERT INTO public."User"(id,"telegramId","updatedAt")
 SELECT v_users[i],'ci-pyr-tg-'||i,v_now AT TIME ZONE 'UTC' FROM generate_subscripts(v_users,1)i ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."Club"(id,"ownerId",name,slug,"updatedAt")
 SELECT v_clubs[i],v_users[i],'CI Pyramid Club '||i,'ci-pyr-club-'||i,v_now AT TIME ZONE 'UTC'
 FROM generate_subscripts(v_clubs,1)i ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."Player"(id,"clubId","firstName","lastName",nationality,age,position,overall,potential,"marketValue",attributes,wage,"contractDays","updatedAt")
 VALUES('ci-pyr-value-player',v_clubs[7],'Test','Value','IR',25,'ST',60,65,11000,'{}'::jsonb,100,365,v_now AT TIME ZONE 'UTC')
 ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."PlayerMarketListing"(id,"playerId","sellerClubId","askingPrice",status,"expiresAt","updatedAt")
 VALUES('ci-pyr-listing','ci-pyr-value-player',v_clubs[7],22000,'OPEN',(v_now AT TIME ZONE 'UTC')+interval '3 days',v_now AT TIME ZONE 'UTC')
 ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."Competition"(id,"idempotencyKey",name,season,format,status,"maxTeams","cupLegs","createdByClubId",rules,"completedAt","updatedAt")
 VALUES(v_comp,'ci-pyr-comp-key-0001','CI Pyramid Tier Two',2026,'LEAGUE','COMPLETED',8,1,v_clubs[1],
 '{"maxSubstitutions":5,"maxInPlayWindows":3,"injuriesEnabled":true,"injuryDurationDays":5,"redCardSuspensionMatches":1,"yellowCardsToSuspend":3,"yellowCardSuspensionMatches":1,"penaltiesOnDraw":false}',
 v_now AT TIME ZONE 'UTC',v_now AT TIME ZONE 'UTC') ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."CompetitionEntry"(id,"competitionId","clubId",points,"goalsFor","goalsAgainst",won,"joinedAt")
 SELECT 'ci-pyr-ce-'||i,v_comp,v_clubs[i],100-i,(100-i)*2,0,10-i,v_now AT TIME ZONE 'UTC'
 FROM generate_series(1,8)i ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."PyramidLeague"(id,"competitionId",tier,season,"groupNumber","createdAt")
 VALUES(v_league,v_comp,2,2026,1,v_now AT TIME ZONE 'UTC') ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."PyramidLeagueEntry"(id,"leagueId","clubId","joinedAt")
 SELECT 'ci-pyr-pe-'||i,v_league,v_clubs[i],v_now AT TIME ZONE 'UTC' FROM generate_series(1,8)i ON CONFLICT(id) DO NOTHING;
 INSERT INTO public."PyramidLeagueApplication"(id,"userId","clubId",tier,season,status,"appliedAt")
 SELECT 'ci-pyr-queue-'||i,v_users[i+8],v_clubs[i+8],1,2027,'QUEUED',(v_now AT TIME ZONE 'UTC')-interval '1 day'
 FROM generate_series(1,6)i ON CONFLICT("clubId",tier,season) DO NOTHING;

 v_result:=public.finalize_pyramid_league_http(v_comp,v_now);
 IF v_result->>'processed'<>'true' OR v_result->>'champion'<>v_clubs[1]
  OR v_result->>'runnerUp'<>v_clubs[2] OR v_result->>'thirdPlace'<>v_clubs[3]
  OR (v_result->>'awardsCreated')::integer<>3 OR (v_result->>'promotionOffersCreated')::integer<>2
  OR (v_result->>'relegationsProcessed')::integer<>2 THEN
  RAISE EXCEPTION 'pyramid finalization mismatch: %',v_result; END IF;
 IF (SELECT count(*) FROM public."LeagueAward" WHERE "leagueId"=v_league)<>3
  OR (SELECT count(*) FROM public."LeaguePromotionOffer" WHERE "leagueId"=v_league AND status='PENDING')<>2
  OR (SELECT count(*) FROM public."PyramidLeagueApplication" WHERE tier=1 AND season=2027 AND status='ASSIGNED')<>8
 THEN RAISE EXCEPTION 'pyramid awards, offers or relegation queue missing'; END IF;
 IF (SELECT "marketValue" FROM public."Player" WHERE id='ci-pyr-value-player')<>10000
  OR (SELECT "askingPrice" FROM public."PlayerMarketListing" WHERE id='ci-pyr-listing')<>20000
 THEN RAISE EXCEPTION 'player/listing market value adjustment mismatch'; END IF;
 IF (SELECT count(*) FROM public."FootballMatch" fm JOIN public."Competition" c ON c.id=fm."competitionId"
  JOIN public."PyramidLeague" pl ON pl."competitionId"=c.id WHERE pl.tier=1 AND pl.season=2027 AND pl."groupNumber"=1)<>28
 THEN RAISE EXCEPTION 'next pyramid league fixtures were not generated'; END IF;
 v_result:=public.finalize_pyramid_league_http(v_comp,v_now);
 IF v_result->>'processed'<>'false' OR (SELECT count(*) FROM public."LeagueAward" WHERE "leagueId"=v_league)<>3
 THEN RAISE EXCEPTION 'pyramid completion replay was not idempotent: %',v_result; END IF;

 SELECT id INTO v_replacement FROM public."LeaguePromotionOffer" WHERE "leagueId"=v_league AND "clubId"=v_clubs[1];
 v_result:=public.respond_promotion_offer_http(v_users[1],v_replacement,false,v_now+interval '1 hour');
 IF v_result->>'accepted'<>'false' OR v_result->>'replacementClubId'<>v_clubs[3] THEN
  RAISE EXCEPTION 'promotion replacement mismatch: %',v_result; END IF;
 v_result:=public.respond_promotion_offer_http(v_users[3],v_result->>'replacementOfferId',true,v_now+interval '2 hours');
 IF v_result->>'accepted'<>'true' OR v_result->>'replayed'<>'false' THEN
  RAISE EXCEPTION 'replacement promotion acceptance mismatch: %',v_result; END IF;
 v_result:=public.respond_promotion_offer_http(v_users[3],(v_result->'offer'->>'id'),true,v_now+interval '2 hours');
 IF v_result->>'replayed'<>'true' THEN RAISE EXCEPTION 'promotion acceptance replay mismatch: %',v_result; END IF;
 v_result:=public.process_due_pyramid_work_http(v_now+interval '26 hours',50);
 IF (v_result->>'accepted')::integer<>1 OR (SELECT status::text FROM public."LeaguePromotionOffer" WHERE "leagueId"=v_league AND "clubId"=v_clubs[2])<>'ACCEPTED'
 THEN RAISE EXCEPTION 'expired promotion auto-accept mismatch: %',v_result; END IF;
END;
$test$;
ROLLBACK;
