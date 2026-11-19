CREATE OR REPLACE FUNCTION public.settle_invalid_match_fixture_http(p_match_id text,p_now timestamp without time zone)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $function$
DECLARE
 m public."FootballMatch"%ROWTYPE; h public."Club"%ROWTYPE; a public."Club"%ROWTYPE; c public."Competition"%ROWTYPE;
 hc integer; ac integer; hg boolean; ag boolean; hf boolean; af boolean; hs integer; ascore integer; winner text;
 home_tg text; away_tg text; challenge record; credit record; inserted integer;
BEGIN
 IF COALESCE(p_match_id,'')='' OR p_now IS NULL THEN RAISE EXCEPTION 'INVALID_MATCH_FORFEIT_INPUT'; END IF;
 SELECT * INTO m FROM public."FootballMatch" WHERE "id"=p_match_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_NOT_FOUND'; END IF;
 IF m."status"::text='COMPLETED' THEN
  SELECT "format" INTO c."format" FROM public."Competition" WHERE "id"=m."competitionId";
  RETURN jsonb_build_object('settled',false,'replayed',true,'matchId',m."id",'competitionId',m."competitionId",'round',m."round",'competitionFormat',c."format"::text);
 END IF;
 IF m."status"::text<>'SCHEDULED' OR m."scheduledAt">p_now THEN RAISE EXCEPTION 'MATCH_NOT_DUE'; END IF;
 IF EXISTS(SELECT 1 FROM public."MatchRuntime" WHERE "matchId"=m."id") THEN RAISE EXCEPTION 'MATCH_RUNTIME_ALREADY_EXISTS'; END IF;
 SELECT * INTO h FROM public."Club" WHERE "id"=m."homeClubId" FOR UPDATE;
 SELECT * INTO a FROM public."Club" WHERE "id"=m."awayClubId" FOR UPDATE;
 IF h."id" IS NULL OR a."id" IS NULL THEN RAISE EXCEPTION 'MATCH_CLUB_NOT_FOUND'; END IF;
 SELECT count(*)::integer,COALESCE(bool_or("position"::text='GK'),false) INTO hc,hg
 FROM public."Player" WHERE "clubId"=h."id" AND "status"::text='ACTIVE' AND "suspensionMatchesRemaining"=0;
 SELECT count(*)::integer,COALESCE(bool_or("position"::text='GK'),false) INTO ac,ag
 FROM public."Player" WHERE "clubId"=a."id" AND "status"::text='ACTIVE' AND "suspensionMatchesRemaining"=0;
 hf:=hc<11 OR NOT hg; af:=ac<11 OR NOT ag;
 IF NOT hf AND NOT af THEN
  SELECT "format" INTO c."format" FROM public."Competition" WHERE "id"=m."competitionId";
  RETURN jsonb_build_object('settled',false,'replayed',false,'matchId',m."id",'competitionId',m."competitionId",'round',m."round",'competitionFormat',c."format"::text);
 END IF;
 hs:=CASE WHEN hf THEN 0 WHEN af THEN 3 ELSE 0 END;
 ascore:=CASE WHEN af THEN 0 WHEN hf THEN 3 ELSE 0 END;
 winner:=CASE WHEN hf AND NOT af THEN a."id" WHEN af AND NOT hf THEN h."id" ELSE NULL END;
 UPDATE public."FootballMatch" SET "status"='COMPLETED',"startedAt"=COALESCE("startedAt",p_now),"completedAt"=p_now,
  "homeScore"=hs,"awayScore"=ascore,"winnerClubId"=winner,"attendance"=0,"ticketRevenue"=0,
  "homeExpectedGoals"=0,"awayExpectedGoals"=0,"updatedAt"=p_now WHERE "id"=m."id" AND "status"='SCHEDULED';
 IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_ALREADY_SIMULATED'; END IF;
 SELECT "telegramId" INTO home_tg FROM public."User" WHERE "id"=h."ownerId";
 SELECT "telegramId" INTO away_tg FROM public."User" WHERE "id"=a."ownerId";
 INSERT INTO public."MatchResultNotification"("id","matchId","channel","telegramChatId","status","availableAt","createdAt","updatedAt")
 VALUES(gen_random_uuid()::text,m."id",'HOME',home_tg,'PENDING',p_now,p_now,p_now),
 (gen_random_uuid()::text,m."id",'AWAY',away_tg,'PENDING',p_now,p_now,p_now) ON CONFLICT("matchId","channel") DO NOTHING;
 SELECT fc."id",tg."telegramId" AS telegram_id INTO challenge FROM public."FriendlyChallenge" fc
 LEFT JOIN public."TelegramGroup" tg ON tg."id"=fc."groupId" WHERE fc."matchId"=m."id" LIMIT 1;
 IF FOUND THEN
  IF challenge.telegram_id IS NOT NULL THEN
   INSERT INTO public."MatchResultNotification"("id","matchId","channel","telegramChatId","status","availableAt","createdAt","updatedAt")
   VALUES(gen_random_uuid()::text,m."id",'GROUP',challenge.telegram_id,'PENDING',p_now,p_now,p_now) ON CONFLICT("matchId","channel") DO NOTHING;
  END IF;
  FOR credit IN SELECT h."ownerId" AS uid,h."id" AS cid,CASE WHEN winner=h."id" THEN 3 WHEN winner IS NULL THEN 1 ELSE 0 END AS amount
   UNION ALL SELECT a."ownerId",a."id",CASE WHEN winner=a."id" THEN 3 WHEN winner IS NULL THEN 1 ELSE 0 END LOOP
   IF credit.amount>0 THEN
    INSERT INTO public."LedgerTransaction"("id","idempotencyKey","userId","asset","direction","amount","reason","referenceType","referenceId","createdAt")
    VALUES(gen_random_uuid()::text,'friendly-challenge-honor:'||m."id"||':'||credit.cid,credit.uid,'HONOR','CREDIT',credit.amount,
     'FRIENDLY_CHALLENGE_HONOR_REWARD','FRIENDLY_CHALLENGE',challenge.id,p_now) ON CONFLICT("idempotencyKey") DO NOTHING;
    GET DIAGNOSTICS inserted=ROW_COUNT;
    IF inserted=1 THEN
     INSERT INTO public."Wallet" AS w("id","userId","asset","balance","version","createdAt","updatedAt")
     VALUES(gen_random_uuid()::text,credit.uid,'HONOR',credit.amount,1,p_now,p_now)
     ON CONFLICT("userId","asset") DO UPDATE SET "balance"=w."balance"+EXCLUDED."balance","version"=w."version"+1,"updatedAt"=p_now;
    END IF;
   END IF;
  END LOOP;
 END IF;
 FOR credit IN SELECT h."ownerId" AS uid,h."id" AS cid,CASE WHEN winner=h."id" THEN 250 WHEN winner IS NULL THEN 150 ELSE 100 END AS amount,'match:'||m."id"||':home-reward' AS ledger_key
  UNION ALL SELECT a."ownerId",a."id",CASE WHEN winner=a."id" THEN 250 WHEN winner IS NULL THEN 150 ELSE 100 END,'match:'||m."id"||':away-reward' LOOP
  INSERT INTO public."LedgerTransaction"("id","idempotencyKey","userId","asset","direction","amount","reason","referenceType","referenceId","createdAt")
  VALUES(gen_random_uuid()::text,credit.ledger_key,credit.uid,'CASH','CREDIT',credit.amount,'MATCH_APPEARANCE_REWARD','FOOTBALL_MATCH',m."id",p_now)
  ON CONFLICT("idempotencyKey") DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  IF inserted=1 THEN
   INSERT INTO public."Wallet" AS w("id","userId","asset","balance","version","createdAt","updatedAt")
   VALUES(gen_random_uuid()::text,credit.uid,'CASH',credit.amount,1,p_now,p_now)
   ON CONFLICT("userId","asset") DO UPDATE SET "balance"=w."balance"+EXCLUDED."balance","version"=w."version"+1,"updatedAt"=p_now;
   INSERT INTO public."ClubFinanceEntry"("id","idempotencyKey","clubId","category","direction","amount","description","occurredAt")
   VALUES(gen_random_uuid()::text,'club-finance:'||credit.ledger_key,credit.cid,'MATCH_REWARD','CREDIT',credit.amount,'Match appearance reward for invalid lineup',p_now)
   ON CONFLICT("idempotencyKey") DO NOTHING;
  END IF;
 END LOOP;
 IF winner IS NOT NULL THEN UPDATE public."Club" SET "reputation"="reputation"+2,"updatedAt"=p_now WHERE "id"=winner;
 ELSE UPDATE public."Club" SET "reputation"="reputation"+1,"updatedAt"=p_now WHERE "id" IN(h."id",a."id"); END IF;
 IF m."competitionId" IS NOT NULL THEN
  SELECT * INTO c FROM public."Competition" WHERE "id"=m."competitionId";
  IF FOUND AND c."format"::text='LEAGUE' THEN
   UPDATE public."CompetitionEntry" SET "played"="played"+1,"won"="won"+CASE WHEN hs>ascore THEN 1 ELSE 0 END,
    "drawn"="drawn"+CASE WHEN hs=ascore THEN 1 ELSE 0 END,"lost"="lost"+CASE WHEN hs<ascore THEN 1 ELSE 0 END,
    "goalsFor"="goalsFor"+hs,"goalsAgainst"="goalsAgainst"+ascore,
    "points"="points"+CASE WHEN hs>ascore THEN 3 WHEN hs=ascore THEN 1 ELSE 0 END
    WHERE "competitionId"=m."competitionId" AND "clubId"=h."id";
   UPDATE public."CompetitionEntry" SET "played"="played"+1,"won"="won"+CASE WHEN ascore>hs THEN 1 ELSE 0 END,
    "drawn"="drawn"+CASE WHEN ascore=hs THEN 1 ELSE 0 END,"lost"="lost"+CASE WHEN ascore<hs THEN 1 ELSE 0 END,
    "goalsFor"="goalsFor"+ascore,"goalsAgainst"="goalsAgainst"+hs,
    "points"="points"+CASE WHEN ascore>hs THEN 3 WHEN ascore=hs THEN 1 ELSE 0 END
    WHERE "competitionId"=m."competitionId" AND "clubId"=a."id";
  END IF;
 END IF;
 RETURN jsonb_build_object('settled',true,'replayed',false,'matchId',m."id",'competitionId',m."competitionId",
  'round',m."round",'competitionFormat',CASE WHEN c."id" IS NULL THEN NULL ELSE c."format"::text END);
END;$function$;
REVOKE ALL ON FUNCTION public.settle_invalid_match_fixture_http(text,timestamp without time zone) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT EXECUTE ON FUNCTION public.settle_invalid_match_fixture_http(text,timestamp without time zone) TO service_role;
END IF; END $grant$;
