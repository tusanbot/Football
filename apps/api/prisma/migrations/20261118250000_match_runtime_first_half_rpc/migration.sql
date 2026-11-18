CREATE OR REPLACE FUNCTION public.advance_match_runtime_first_half(
 p_runtime_id text,p_expected_state_version integer,p_lease_token text,p_simulation_state jsonb,
 p_started_at timestamp without time zone,p_checkpoint_at timestamp without time zone,
 p_decision_deadline_at timestamp without time zone,p_events jsonb
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $function$
DECLARE
 runtime_row public."MatchRuntime"%ROWTYPE;
 match_row public."FootballMatch"%ROWTYPE;
 event_row record;
BEGIN
 IF p_runtime_id IS NULL OR p_expected_state_version IS NULL OR p_lease_token IS NULL OR p_lease_token=''
  OR p_simulation_state IS NULL OR jsonb_typeof(p_simulation_state)<>'object'
  OR p_started_at IS NULL OR p_checkpoint_at IS NULL OR p_decision_deadline_at IS NULL
  OR p_decision_deadline_at<p_checkpoint_at OR p_events IS NULL OR jsonb_typeof(p_events)<>'array' THEN
  RAISE EXCEPTION 'INVALID_MATCH_RUNTIME_FIRST_HALF_COMMAND';
 END IF;
 SELECT * INTO runtime_row FROM public."MatchRuntime" WHERE "id"=p_runtime_id FOR UPDATE;
 IF NOT FOUND OR runtime_row."stateVersion"<>p_expected_state_version
  OR runtime_row."leaseToken" IS DISTINCT FROM p_lease_token
  OR runtime_row."status"::text NOT IN ('QUEUED','RUNNING','AWAITING_CHECKPOINT') THEN
  RETURN false;
 END IF;
 SELECT * INTO match_row FROM public."FootballMatch" WHERE "id"=runtime_row."matchId" FOR UPDATE;
 IF NOT FOUND OR match_row."status"::text<>'SCHEDULED' THEN RETURN false; END IF;

 UPDATE public."MatchRuntime" SET "status"='AWAITING_CHECKPOINT',"currentMinute"=45,
  "stateVersion"="stateVersion"+1,"simulationState"=p_simulation_state,
  "startedAt"=COALESCE("startedAt",p_started_at),"nextActionAt"=p_checkpoint_at,
  "lastError"=NULL,"updatedAt"=NOW()
 WHERE "id"=p_runtime_id AND "stateVersion"=p_expected_state_version AND "leaseToken"=p_lease_token;
 IF NOT FOUND THEN RETURN false; END IF;

 UPDATE public."FootballMatch" SET "status"='IN_PROGRESS',"startedAt"=COALESCE("startedAt",p_started_at),"updatedAt"=NOW()
 WHERE "id"=runtime_row."matchId" AND "status"='SCHEDULED';
 IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_NOT_SCHEDULED'; END IF;

 INSERT INTO public."MatchTacticalCheckpoint"(
  "id","matchId","checkpointKey","kind","minute","status","openedAt","decisionDeadlineAt","nextSegmentAt","createdAt","updatedAt"
 ) VALUES(gen_random_uuid()::text,runtime_row."matchId",'minute-45','HALF_TIME',45,'OPEN',
  p_checkpoint_at,p_decision_deadline_at,p_decision_deadline_at,NOW(),NOW())
 ON CONFLICT("matchId","checkpointKey") DO NOTHING;

 FOR event_row IN SELECT * FROM jsonb_to_recordset(p_events) AS e(
  event_key text,kind text,minute integer,home_score integer,away_score integer,payload jsonb,available_at timestamp without time zone
 ) LOOP
  IF event_row.event_key IS NULL OR event_row.kind IS NULL OR event_row.minute IS NULL
   OR event_row.home_score IS NULL OR event_row.away_score IS NULL OR event_row.available_at IS NULL THEN
   RAISE EXCEPTION 'INVALID_MATCH_LIFECYCLE_EVENT';
  END IF;
  INSERT INTO public."MatchLifecycleNotification"(
   "id","matchId","channel","eventKey","kind","minute","homeScore","awayScore","telegramChatId",
   "payload","status","attempts","availableAt","createdAt","updatedAt"
  )
  SELECT gen_random_uuid()::text,runtime_row."matchId",recipient.channel,event_row.event_key,event_row.kind,
   event_row.minute,event_row.home_score,event_row.away_score,recipient.telegram_id,event_row.payload,
   'PENDING',0,event_row.available_at,NOW(),NOW()
  FROM (
   SELECT 'HOME'::text AS channel,u."telegramId" AS telegram_id
   FROM public."Club" c JOIN public."User" u ON u."id"=c."ownerId" WHERE c."id"=match_row."homeClubId"
   UNION ALL
   SELECT 'AWAY'::text,u."telegramId"
   FROM public."Club" c JOIN public."User" u ON u."id"=c."ownerId" WHERE c."id"=match_row."awayClubId"
   UNION ALL
   SELECT 'GROUP'::text,g."telegramId"
   FROM public."FriendlyChallenge" fc JOIN public."TelegramGroup" g ON g."id"=fc."groupId"
   WHERE fc."matchId"=runtime_row."matchId" AND g."telegramId" IS NOT NULL
  ) recipient
  ON CONFLICT("matchId","channel","eventKey") DO NOTHING;
 END LOOP;
 RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.advance_match_runtime_first_half(text,integer,text,jsonb,timestamp without time zone,timestamp without time zone,timestamp without time zone,jsonb) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT EXECUTE ON FUNCTION public.advance_match_runtime_first_half(text,integer,text,jsonb,timestamp without time zone,timestamp without time zone,timestamp without time zone,jsonb) TO service_role;
END IF; END $grant$;
