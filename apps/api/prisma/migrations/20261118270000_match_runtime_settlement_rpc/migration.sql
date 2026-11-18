CREATE OR REPLACE FUNCTION public.settle_match_runtime_result(
 p_match_id text,
 p_runtime_id text,
 p_lease_token text,
 p_now timestamp without time zone,
 p_result jsonb,
 p_injury_duration_days integer,
 p_red_card_suspension_matches integer,
 p_yellow_cards_to_suspend integer,
 p_yellow_card_suspension_matches integer,
 p_home_reward bigint,
 p_away_reward bigint
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
 match_row public."FootballMatch"%ROWTYPE;
 runtime_row public."MatchRuntime"%ROWTYPE;
 home_club public."Club"%ROWTYPE;
 away_club public."Club"%ROWTYPE;
 challenge_row record;
 competition_row public."Competition"%ROWTYPE;
 item jsonb;
 effect jsonb;
 credit record;
 inserted_count integer;
 previous_yellows integer;
 current_yellows integer;
 lineup_changed text[] := ARRAY[]::text[];
 injured_ids text[] := ARRAY[]::text[];
 red_ids text[] := ARRAY[]::text[];
 yellow_ids text[] := ARRAY[]::text[];
 home_points integer;
 away_points integer;
BEGIN
 IF p_match_id IS NULL OR p_runtime_id IS NULL OR p_lease_token IS NULL OR p_lease_token=''
  OR p_now IS NULL OR jsonb_typeof(p_result)<>'object'
  OR p_injury_duration_days<0 OR p_red_card_suspension_matches<0
  OR p_yellow_cards_to_suspend<0 OR p_yellow_card_suspension_matches<0
  OR p_home_reward<0 OR p_away_reward<0 THEN
  RAISE EXCEPTION 'INVALID_MATCH_RUNTIME_SETTLEMENT';
 END IF;
 SELECT * INTO match_row FROM public."FootballMatch" WHERE "id"=p_match_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_NOT_FOUND'; END IF;
 IF match_row."status"::text='COMPLETED' THEN
  RETURN jsonb_build_object('replayed',true,'matchId',match_row."id",
   'competitionId',match_row."competitionId",'round',match_row."round",
   'homeScore',match_row."homeScore",'awayScore',match_row."awayScore",
   'homePenalties',match_row."homePenalties",'awayPenalties',match_row."awayPenalties",
   'winnerClubId',match_row."winnerClubId",'attendance',match_row."attendance",
   'ticketRevenue',match_row."ticketRevenue"::text);
 END IF;
 SELECT * INTO runtime_row FROM public."MatchRuntime"
 WHERE "id"=p_runtime_id AND "matchId"=p_match_id FOR UPDATE;
 IF NOT FOUND OR runtime_row."status"::text<>'RUNNING'
  OR runtime_row."currentMinute"<>90 OR runtime_row."leaseToken" IS DISTINCT FROM p_lease_token THEN
  RAISE EXCEPTION 'MATCH_RUNTIME_CONCURRENT_MODIFICATION';
 END IF;
 IF match_row."status"::text<>'IN_PROGRESS' THEN RAISE EXCEPTION 'MATCH_NOT_IN_PROGRESS'; END IF;
 SELECT * INTO home_club FROM public."Club" WHERE "id"=match_row."homeClubId" FOR UPDATE;
 SELECT * INTO away_club FROM public."Club" WHERE "id"=match_row."awayClubId" FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_CLUB_NOT_FOUND'; END IF;
 IF (p_result->>'homeScore') IS NULL OR (p_result->>'awayScore') IS NULL
  OR jsonb_typeof(p_result->'events')<>'array'
  OR jsonb_typeof(p_result->'performances')<>'array' THEN
  RAISE EXCEPTION 'INVALID_MATCH_RESULT_PAYLOAD';
 END IF;
 IF match_row."competitionId" IS NOT NULL THEN
  SELECT * INTO competition_row FROM public."Competition" WHERE "id"=match_row."competitionId";
 END IF;

 UPDATE public."FootballMatch" SET
  "status"='COMPLETED',"startedAt"=COALESCE("startedAt",p_now),"completedAt"=p_now,
  "homeScore"=(p_result->>'homeScore')::integer,"awayScore"=(p_result->>'awayScore')::integer,
  "homePenalties"=NULLIF(p_result->>'homePenalties','')::integer,
  "awayPenalties"=NULLIF(p_result->>'awayPenalties','')::integer,
  "winnerClubId"=NULLIF(p_result->>'winnerClubId',''),
  "attendance"=COALESCE((p_result->>'attendance')::integer,0),
  "ticketRevenue"=COALESCE((p_result->>'ticketRevenue')::bigint,0),
  "homeExpectedGoals"=NULLIF(p_result->>'homeExpectedGoals','')::double precision,
  "awayExpectedGoals"=NULLIF(p_result->>'awayExpectedGoals','')::double precision,
  "updatedAt"=p_now
 WHERE "id"=p_match_id AND "status"='IN_PROGRESS';
 IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_ALREADY_SIMULATED'; END IF;

 UPDATE public."MatchRuntime" SET "status"='COMPLETED',"completedAt"=p_now,
  "nextActionAt"=NULL,"leaseOwner"=NULL,"leaseToken"=NULL,"leaseExpiresAt"=NULL,
  "lastError"=NULL,"stateVersion"="stateVersion"+1,"updatedAt"=p_now
 WHERE "id"=p_runtime_id AND "status"='RUNNING' AND "currentMinute"=90
  AND "leaseToken"=p_lease_token;
 IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_RUNTIME_CONCURRENT_MODIFICATION'; END IF;

 FOR item IN SELECT value FROM jsonb_array_elements(p_result->'events') LOOP
  INSERT INTO public."MatchEvent"("id","matchId","sequence","minute","type","teamId","playerId","relatedPlayerId","detail","createdAt")
  VALUES(gen_random_uuid()::text,p_match_id,(item->>'sequence')::integer,(item->>'minute')::integer,
   (item->>'type')::public."MatchEventType",item->>'teamId',item->>'playerId',
   NULLIF(item->>'relatedPlayerId',''),COALESCE(item->>'detail',''),p_now)
  ON CONFLICT ("matchId","sequence") DO NOTHING;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_result->'performances') LOOP
  INSERT INTO public."PlayerMatchPerformance"(
   "id","matchId","playerId","clubId","minutesPlayed","goals","assists","shots","passes","tackles",
   "yellowCards","redCards","rating","fitnessLoss"
  ) VALUES(gen_random_uuid()::text,p_match_id,item->>'playerId',item->>'clubId',
   COALESCE((item->>'minutesPlayed')::integer,0),COALESCE((item->>'goals')::integer,0),
   COALESCE((item->>'assists')::integer,0),COALESCE((item->>'shots')::integer,0),
   COALESCE((item->>'passes')::integer,0),COALESCE((item->>'tackles')::integer,0),
   COALESCE((item->>'yellowCards')::integer,0),COALESCE((item->>'redCards')::integer,0),
   (item->>'rating')::double precision,COALESCE((item->>'fitnessLoss')::integer,0))
  ON CONFLICT ("matchId","playerId") DO NOTHING;
  IF COALESCE((item->>'minutesPlayed')::integer,0)>0 THEN
   UPDATE public."Player" SET
    "status"=CASE WHEN (p_result->'injuredPlayerIds') @> to_jsonb(ARRAY[item->>'playerId']) THEN 'INJURED'::public."PlayerStatus" ELSE "status" END,
    "injuryUntil"=CASE WHEN (p_result->'injuredPlayerIds') @> to_jsonb(ARRAY[item->>'playerId'])
      THEN p_now + make_interval(days=>p_injury_duration_days) ELSE "injuryUntil" END,
    "lineupSlot"=CASE WHEN (p_result->'injuredPlayerIds') @> to_jsonb(ARRAY[item->>'playerId']) THEN NULL ELSE "lineupSlot" END,
    "fitness"=GREATEST(0,"fitness"-COALESCE((item->>'fitnessLoss')::integer,0)
      - CASE WHEN (p_result->'injuredPlayerIds') @> to_jsonb(ARRAY[item->>'playerId']) THEN 15 ELSE 0 END),
    "updatedAt"=p_now
   WHERE "id"=item->>'playerId' AND "clubId"=item->>'clubId' AND "status"='ACTIVE';
   IF FOUND AND (p_result->'injuredPlayerIds') @> to_jsonb(ARRAY[item->>'playerId']) THEN
    lineup_changed := array_append(lineup_changed,item->>'clubId');
   END IF;
  END IF;
 END LOOP;

 IF COALESCE((p_result->>'forfeit')::boolean,false)=false THEN
  UPDATE public."Player" SET "suspensionMatchesRemaining"="suspensionMatchesRemaining"-1,"updatedAt"=p_now
  WHERE "clubId" IN (home_club."id",away_club."id") AND "suspensionMatchesRemaining">0;
 END IF;
 SELECT COALESCE(array_agg(DISTINCT value),ARRAY[]::text[]) INTO red_ids
 FROM jsonb_array_elements_text(COALESCE(p_result->'redCardPlayerIds','[]'::jsonb));
 IF p_red_card_suspension_matches>0 AND cardinality(red_ids)>0 THEN
  UPDATE public."Player" SET "suspensionMatchesRemaining"=p_red_card_suspension_matches,"updatedAt"=p_now
  WHERE "id"=ANY(red_ids) AND "status"='ACTIVE';
  SELECT COALESCE(array_agg(DISTINCT "clubId"),ARRAY[]::text[]) INTO lineup_changed
  FROM public."Player" WHERE "id"=ANY(red_ids);
 END IF;
 IF match_row."competitionId" IS NOT NULL AND p_yellow_cards_to_suspend>0 AND p_yellow_card_suspension_matches>0 THEN
  FOR item IN
   SELECT jsonb_build_object('playerId',e.value->>'playerId','count',count(*)::integer)
   FROM jsonb_array_elements(p_result->'events') AS e(value)
   WHERE e.value->>'type'='YELLOW_CARD' GROUP BY e.value->>'playerId'
  LOOP
   IF item->>'playerId'=ANY(red_ids) THEN CONTINUE; END IF;
   SELECT count(*) INTO previous_yellows FROM public."MatchEvent" me
   JOIN public."FootballMatch" fm ON fm."id"=me."matchId"
   WHERE me."playerId"=item.value->>'playerId' AND me."type"='YELLOW_CARD'
    AND me."matchId"<>p_match_id AND fm."competitionId"=match_row."competitionId";
   current_yellows := (item.value->>'count')::integer;
   IF floor((previous_yellows+current_yellows)::numeric/p_yellow_cards_to_suspend)
      > floor(previous_yellows::numeric/p_yellow_cards_to_suspend) THEN
    UPDATE public."Player" SET "suspensionMatchesRemaining"="suspensionMatchesRemaining"+p_yellow_card_suspension_matches,
     "updatedAt"=p_now WHERE "id"=item.value->>'playerId' AND "status"='ACTIVE';
    SELECT COALESCE(array_agg(DISTINCT "clubId"),ARRAY[]::text[]) INTO yellow_ids
    FROM public."Player" WHERE "id"=item.value->>'playerId';
   END IF;
  END LOOP;
 END IF;
 lineup_changed := ARRAY(SELECT DISTINCT unnest(lineup_changed || yellow_ids));
 IF cardinality(lineup_changed)>0 THEN
  UPDATE public."Club" SET "lineupVersion"="lineupVersion"+1,"updatedAt"=p_now WHERE "id"=ANY(lineup_changed);
 END IF;

 IF NULLIF(p_result->>'winnerClubId','') IS NOT NULL THEN
  UPDATE public."Club" SET "reputation"="reputation"+2,"updatedAt"=p_now WHERE "id"=p_result->>'winnerClubId';
 ELSE
  UPDATE public."Club" SET "reputation"="reputation"+1,"updatedAt"=p_now WHERE "id" IN (home_club."id",away_club."id");
 END IF;

 INSERT INTO public."MatchResultNotification"("id","matchId","channel","telegramChatId","status","availableAt","createdAt","updatedAt")
 SELECT gen_random_uuid()::text,p_match_id,'HOME',u."telegramId",'PENDING',p_now,p_now,p_now
 FROM public."User" u WHERE u."id"=home_club."ownerId"
 ON CONFLICT ("matchId","channel") DO NOTHING;
 INSERT INTO public."MatchResultNotification"("id","matchId","channel","telegramChatId","status","availableAt","createdAt","updatedAt")
 SELECT gen_random_uuid()::text,p_match_id,'AWAY',u."telegramId",'PENDING',p_now,p_now,p_now
 FROM public."User" u WHERE u."id"=away_club."ownerId"
 ON CONFLICT ("matchId","channel") DO NOTHING;
 SELECT fc."id",tg."telegramId" INTO challenge_row
 FROM public."FriendlyChallenge" fc LEFT JOIN public."TelegramGroup" tg ON tg."id"=fc."groupId"
 WHERE fc."matchId"=p_match_id LIMIT 1;
 IF FOUND AND challenge_row.telegramId IS NOT NULL THEN
  INSERT INTO public."MatchResultNotification"("id","matchId","channel","telegramChatId","status","availableAt","createdAt","updatedAt")
  VALUES(gen_random_uuid()::text,p_match_id,'GROUP',challenge_row.telegramId,'PENDING',p_now,p_now,p_now)
  ON CONFLICT ("matchId","channel") DO NOTHING;
  FOR credit IN
   SELECT home_club."ownerId" AS user_id,home_club."id" AS club_id,
    CASE WHEN p_result->>'winnerClubId'=home_club."id" THEN 3 WHEN p_result->>'winnerClubId' IS NULL THEN 1 ELSE 0 END AS amount
   UNION ALL
   SELECT away_club."ownerId",away_club."id",
    CASE WHEN p_result->>'winnerClubId'=away_club."id" THEN 3 WHEN p_result->>'winnerClubId' IS NULL THEN 1 ELSE 0 END
  LOOP
   IF credit.amount<=0 THEN CONTINUE; END IF;
   INSERT INTO public."LedgerTransaction"("id","idempotencyKey","userId","asset","direction","amount","reason","referenceType","referenceId","createdAt")
   VALUES(gen_random_uuid()::text,'friendly-challenge-honor:'||p_match_id||':'||credit.club_id,
    credit.user_id,'HONOR','CREDIT',credit.amount,'FRIENDLY_CHALLENGE_HONOR_REWARD','FRIENDLY_CHALLENGE',challenge_row.id,p_now)
   ON CONFLICT ("idempotencyKey") DO NOTHING;
   GET DIAGNOSTICS inserted_count=ROW_COUNT;
   IF inserted_count=1 THEN
    INSERT INTO public."Wallet"("id","userId","asset","balance","version","createdAt","updatedAt")
    VALUES(gen_random_uuid()::text,credit.user_id,'HONOR',credit.amount,1,p_now,p_now)
    ON CONFLICT ("userId","asset") DO UPDATE SET "balance"=public."Wallet"."balance"+EXCLUDED."balance",
     "version"=public."Wallet"."version"+1,"updatedAt"=p_now;
   END IF;
  END LOOP;
 END IF;

 FOR credit IN
  SELECT home_club."ownerId" AS user_id,home_club."id" AS club_id,
   'match:'||p_match_id||':home-gate' AS ledger_key,'MATCH_GATE_REVENUE' AS reason,
   'MATCH_GATE_REVENUE' AS category,'Match gate receipts for attendance '||(p_result->>'attendance') AS description,
   COALESCE((p_result->>'ticketRevenue')::bigint,0) AS amount
  UNION ALL
  SELECT home_club."ownerId",home_club."id",'match:'||p_match_id||':home-reward',
   'MATCH_APPEARANCE_REWARD','MATCH_REWARD','Home match reward '||p_home_reward,p_home_reward
  UNION ALL
  SELECT away_club."ownerId",away_club."id",'match:'||p_match_id||':away-reward',
   'MATCH_APPEARANCE_REWARD','MATCH_REWARD','Away match reward '||p_away_reward,p_away_reward
 LOOP
  IF credit.amount<=0 THEN CONTINUE; END IF;
  INSERT INTO public."LedgerTransaction"("id","idempotencyKey","userId","asset","direction","amount","reason","referenceType","referenceId","createdAt")
  VALUES(gen_random_uuid()::text,credit.ledger_key,credit.user_id,'CASH','CREDIT',credit.amount,
   credit.reason,'FOOTBALL_MATCH',p_match_id,p_now)
  ON CONFLICT ("idempotencyKey") DO NOTHING;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  IF inserted_count=1 THEN
   INSERT INTO public."Wallet"("id","userId","asset","balance","version","createdAt","updatedAt")
   VALUES(gen_random_uuid()::text,credit.user_id,'CASH',credit.amount,1,p_now,p_now)
   ON CONFLICT ("userId","asset") DO UPDATE SET "balance"=public."Wallet"."balance"+EXCLUDED."balance",
    "version"=public."Wallet"."version"+1,"updatedAt"=p_now;
   INSERT INTO public."ClubFinanceEntry"("id","idempotencyKey","clubId","category","direction","amount","description","occurredAt")
   VALUES(gen_random_uuid()::text,'club-finance:'||credit.ledger_key,credit.club_id,credit.category,
    'CREDIT',credit.amount,credit.description,p_now)
   ON CONFLICT ("idempotencyKey") DO NOTHING;
  END IF;
 END LOOP;

 IF match_row."competitionId" IS NOT NULL AND competition_row."format"::text='LEAGUE' THEN
  home_points:=CASE WHEN (p_result->>'homeScore')::integer>(p_result->>'awayScore')::integer THEN 3
   WHEN (p_result->>'homeScore')::integer=(p_result->>'awayScore')::integer THEN 1 ELSE 0 END;
  away_points:=CASE WHEN (p_result->>'awayScore')::integer>(p_result->>'homeScore')::integer THEN 3
   WHEN (p_result->>'awayScore')::integer=(p_result->>'homeScore')::integer THEN 1 ELSE 0 END;
  UPDATE public."CompetitionEntry" SET "played"="played"+1,"won"="won"+CASE WHEN home_points=3 THEN 1 ELSE 0 END,
   "drawn"="drawn"+CASE WHEN home_points=1 THEN 1 ELSE 0 END,"lost"="lost"+CASE WHEN home_points=0 THEN 1 ELSE 0 END,
   "goalsFor"="goalsFor"+(p_result->>'homeScore')::integer,
   "goalsAgainst"="goalsAgainst"+(p_result->>'awayScore')::integer,"points"="points"+home_points
  WHERE "competitionId"=match_row."competitionId" AND "clubId"=home_club."id";
  UPDATE public."CompetitionEntry" SET "played"="played"+1,"won"="won"+CASE WHEN away_points=3 THEN 1 ELSE 0 END,
   "drawn"="drawn"+CASE WHEN away_points=1 THEN 1 ELSE 0 END,"lost"="lost"+CASE WHEN away_points=0 THEN 1 ELSE 0 END,
   "goalsFor"="goalsFor"+(p_result->>'awayScore')::integer,
   "goalsAgainst"="goalsAgainst"+(p_result->>'homeScore')::integer,"points"="points"+away_points
  WHERE "competitionId"=match_row."competitionId" AND "clubId"=away_club."id";
 END IF;

 RETURN jsonb_build_object('replayed',false,'matchId',match_row."id",
  'competitionId',match_row."competitionId",'round',match_row."round",
  'homeClub',home_club."name",'awayClub',away_club."name",
  'homeScore',(p_result->>'homeScore')::integer,'awayScore',(p_result->>'awayScore')::integer,
  'homePenalties',NULLIF(p_result->>'homePenalties','')::integer,
  'awayPenalties',NULLIF(p_result->>'awayPenalties','')::integer,
  'winnerClubId',NULLIF(p_result->>'winnerClubId',''),
  'attendance',COALESCE((p_result->>'attendance')::integer,0),
  'ticketRevenue',COALESCE((p_result->>'ticketRevenue')::bigint,0)::text,
  'events',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',me."id",'matchId',me."matchId",'sequence',me."sequence",'minute',me."minute",
   'type',me."type"::text,'teamId',me."teamId",'playerId',me."playerId",
   'relatedPlayerId',me."relatedPlayerId",'detail',me."detail",
   'playerName',COALESCE(p."firstName"||' '||p."lastName",'Player'),
   'relatedPlayerName',CASE WHEN rp."id" IS NULL THEN NULL ELSE rp."firstName"||' '||rp."lastName" END
  ) ORDER BY me."sequence") FROM public."MatchEvent" me
   LEFT JOIN public."Player" p ON p."id"=me."playerId"
   LEFT JOIN public."Player" rp ON rp."id"=me."relatedPlayerId"
   WHERE me."matchId"=p_match_id),'[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_match_runtime_result(text,text,text,timestamp without time zone,jsonb,integer,integer,integer,integer,bigint,bigint) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.settle_match_runtime_result(text,text,text,timestamp without time zone,jsonb,integer,integer,integer,integer,bigint,bigint) TO service_role;
 END IF;
END $grant$;
