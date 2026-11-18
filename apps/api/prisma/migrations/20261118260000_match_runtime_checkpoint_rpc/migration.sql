CREATE OR REPLACE FUNCTION public.resolve_match_runtime_checkpoint(
 p_runtime_id text,p_checkpoint_id text,p_expected_state_version integer,p_lease_token text,
 p_resolution jsonb,p_next_minute integer,p_simulation_state jsonb,p_next_action_at timestamp without time zone,
 p_events jsonb,p_next_checkpoint jsonb
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $function$
DECLARE
 runtime_row public."MatchRuntime"%ROWTYPE;
 match_row public."FootballMatch"%ROWTYPE;
 checkpoint_row public."MatchTacticalCheckpoint"%ROWTYPE;
 event_row record;
BEGIN
 IF p_runtime_id IS NULL OR p_checkpoint_id IS NULL OR p_expected_state_version IS NULL
  OR p_lease_token IS NULL OR p_lease_token='' OR p_resolution IS NULL
  OR jsonb_typeof(p_resolution)<>'object' OR p_next_minute NOT IN (60,75,90)
  OR p_simulation_state IS NULL OR jsonb_typeof(p_simulation_state)<>'object'
  OR p_next_action_at IS NULL OR p_events IS NULL OR jsonb_typeof(p_events)<>'array'
  OR (p_next_minute=90 AND p_next_checkpoint IS NOT NULL)
  OR (p_next_minute<90 AND (p_next_checkpoint IS NULL OR jsonb_typeof(p_next_checkpoint)<>'object')) THEN
  RAISE EXCEPTION 'INVALID_MATCH_RUNTIME_CHECKPOINT_COMMAND';
 END IF;
 SELECT * INTO runtime_row FROM public."MatchRuntime" WHERE "id"=p_runtime_id FOR UPDATE;
 IF NOT FOUND OR runtime_row."stateVersion"<>p_expected_state_version
  OR runtime_row."leaseToken" IS DISTINCT FROM p_lease_token
  OR runtime_row."status"::text NOT IN ('AWAITING_CHECKPOINT','RUNNING') THEN RETURN false; END IF;
 SELECT * INTO match_row FROM public."FootballMatch" WHERE "id"=runtime_row."matchId" FOR UPDATE;
 IF NOT FOUND OR match_row."status"::text<>'IN_PROGRESS' THEN RETURN false; END IF;
 SELECT * INTO checkpoint_row FROM public."MatchTacticalCheckpoint"
  WHERE "id"=p_checkpoint_id AND "matchId"=runtime_row."matchId" FOR UPDATE;
 IF NOT FOUND OR checkpoint_row."status"::text<>'OPEN' THEN RETURN false; END IF;
 IF p_next_minute<>(CASE checkpoint_row."minute" WHEN 45 THEN 60 WHEN 60 THEN 75 WHEN 75 THEN 90 ELSE -1 END) THEN
  RAISE EXCEPTION 'INVALID_MATCH_RUNTIME_CHECKPOINT_SEQUENCE';
 END IF;

 UPDATE public."MatchTacticalCheckpoint" SET "status"='RESOLVED',"resolvedAt"=NOW(),
  "resolution"=p_resolution,"updatedAt"=NOW()
 WHERE "id"=p_checkpoint_id AND "status"='OPEN';
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public."MatchRuntime" SET "status"='RUNNING',"currentMinute"=p_next_minute,
  "stateVersion"="stateVersion"+1,"simulationState"=p_simulation_state,
  "nextActionAt"=p_next_action_at,"lastError"=NULL,"updatedAt"=NOW()
 WHERE "id"=p_runtime_id AND "stateVersion"=p_expected_state_version AND "leaseToken"=p_lease_token;
 IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_RUNTIME_CONCURRENT_MODIFICATION'; END IF;

 IF p_next_checkpoint IS NOT NULL THEN
  IF (p_next_checkpoint->>'minute')::integer<>p_next_minute
   OR p_next_checkpoint->>'checkpoint_key'<>('minute-'||p_next_minute::text)
   OR p_next_checkpoint->>'kind'<>(CASE p_next_minute WHEN 60 THEN 'MINUTE_60' ELSE 'MINUTE_75' END)
   OR (p_next_checkpoint->>'opened_at') IS NULL
   OR (p_next_checkpoint->>'decision_deadline_at') IS NULL
   OR (p_next_checkpoint->>'next_segment_at') IS NULL THEN
   RAISE EXCEPTION 'INVALID_NEXT_MATCH_CHECKPOINT';
  END IF;
  INSERT INTO public."MatchTacticalCheckpoint"(
   "id","matchId","checkpointKey","kind","minute","status","openedAt","decisionDeadlineAt","nextSegmentAt","createdAt","updatedAt"
  ) VALUES(gen_random_uuid()::text,runtime_row."matchId",p_next_checkpoint->>'checkpoint_key',
   (p_next_checkpoint->>'kind')::public."MatchCheckpointKind",p_next_minute,'OPEN',
   (p_next_checkpoint->>'opened_at')::timestamp,(p_next_checkpoint->>'decision_deadline_at')::timestamp,
   (p_next_checkpoint->>'next_segment_at')::timestamp,NOW(),NOW())
  ON CONFLICT("matchId","checkpointKey") DO NOTHING;
 END IF;

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
REVOKE ALL ON FUNCTION public.resolve_match_runtime_checkpoint(text,text,integer,text,jsonb,integer,jsonb,timestamp without time zone,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT EXECUTE ON FUNCTION public.resolve_match_runtime_checkpoint(text,text,integer,text,jsonb,integer,jsonb,timestamp without time zone,jsonb,jsonb) TO service_role;
END IF; END $grant$;


CREATE OR REPLACE FUNCTION public.get_match_runtime_open_checkpoint(p_match_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $function$
 SELECT CASE WHEN checkpoint_row."id" IS NULL THEN NULL ELSE jsonb_build_object(
  'checkpoint',jsonb_build_object(
   'id',checkpoint_row."id",'checkpointKey',checkpoint_row."checkpointKey",
   'kind',checkpoint_row."kind"::text,'minute',checkpoint_row."minute",
   'status',checkpoint_row."status"::text,'openedAt',checkpoint_row."openedAt",
   'decisionDeadlineAt',checkpoint_row."decisionDeadlineAt",'nextSegmentAt',checkpoint_row."nextSegmentAt"
  ),
  'decisions',COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
    'id',decision."id",'clubId',decision."clubId",'submittedAt',decision."submittedAt",
    'instruction',decision."instruction"
   ) ORDER BY decision."submittedAt" DESC,decision."id" ASC)
   FROM public."MatchTacticalDecision" decision
   WHERE decision."checkpointId"=checkpoint_row."id"
  ),'[]'::jsonb)
 ) END
 FROM LATERAL (
  SELECT cp.* FROM public."MatchTacticalCheckpoint" cp
  WHERE cp."matchId"=p_match_id AND cp."status"='OPEN'
  ORDER BY cp."minute" ASC LIMIT 1
 ) checkpoint_row;
$function$;
REVOKE ALL ON FUNCTION public.get_match_runtime_open_checkpoint(text) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT EXECUTE ON FUNCTION public.get_match_runtime_open_checkpoint(text) TO service_role;
END IF; END $grant$;

CREATE OR REPLACE FUNCTION public.submit_match_runtime_tactical_decision(
 p_user_id text,p_match_id text,p_checkpoint_key text,p_idempotency_key text,
 p_instruction jsonb,p_submitted_at timestamp without time zone
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $function$
DECLARE
 match_row public."FootballMatch"%ROWTYPE;
 checkpoint_row public."MatchTacticalCheckpoint"%ROWTYPE;
 club_id text;
 decision_row public."MatchTacticalDecision"%ROWTYPE;
BEGIN
 IF p_user_id IS NULL OR p_match_id IS NULL OR p_checkpoint_key IS NULL OR p_checkpoint_key=''
  OR p_idempotency_key IS NULL OR p_idempotency_key='' OR p_instruction IS NULL
  OR jsonb_typeof(p_instruction)<>'object' OR p_submitted_at IS NULL THEN
  RAISE EXCEPTION 'INVALID_MATCH_TACTICAL_DECISION';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
 SELECT * INTO match_row FROM public."FootballMatch" WHERE "id"=p_match_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_NOT_FOUND'; END IF;
 SELECT c."id" INTO club_id FROM public."Club" c
 WHERE c."ownerId"=p_user_id AND c."id" IN (match_row."homeClubId",match_row."awayClubId") LIMIT 1;
 IF club_id IS NULL THEN RAISE EXCEPTION 'NOT_MATCH_PARTICIPANT'; END IF;
 SELECT * INTO checkpoint_row FROM public."MatchTacticalCheckpoint"
 WHERE "matchId"=p_match_id AND "checkpointKey"=p_checkpoint_key FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_CHECKPOINT_NOT_FOUND'; END IF;
 SELECT * INTO decision_row FROM public."MatchTacticalDecision"
 WHERE "idempotencyKey"=p_idempotency_key;
 IF FOUND THEN
  IF decision_row."checkpointId"<>checkpoint_row."id" OR decision_row."clubId"<>club_id
   OR decision_row."submittedByUserId"<>p_user_id THEN
   RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;
  RETURN jsonb_build_object('decision',jsonb_build_object(
   'id',decision_row."id",'checkpointId',decision_row."checkpointId",'clubId',decision_row."clubId",
   'submittedByUserId',decision_row."submittedByUserId",'idempotencyKey',decision_row."idempotencyKey",
   'instruction',decision_row."instruction",'submittedAt',decision_row."submittedAt"
  ),'replayed',true);
 END IF;
 IF checkpoint_row."status"::text<>'OPEN'
  OR p_submitted_at<checkpoint_row."openedAt"
  OR p_submitted_at>=LEAST(checkpoint_row."decisionDeadlineAt",checkpoint_row."nextSegmentAt") THEN
  RAISE EXCEPTION 'MATCH_CHECKPOINT_CLOSED';
 END IF;
 INSERT INTO public."MatchTacticalDecision"(
  "id","idempotencyKey","checkpointId","clubId","submittedByUserId","instruction","submittedAt"
 ) VALUES(gen_random_uuid()::text,p_idempotency_key,checkpoint_row."id",club_id,p_user_id,p_instruction,p_submitted_at)
 RETURNING * INTO decision_row;
 RETURN jsonb_build_object('decision',jsonb_build_object(
  'id',decision_row."id",'checkpointId',decision_row."checkpointId",'clubId',decision_row."clubId",
  'submittedByUserId',decision_row."submittedByUserId",'idempotencyKey',decision_row."idempotencyKey",
  'instruction',decision_row."instruction",'submittedAt',decision_row."submittedAt"
 ),'replayed',false);
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_match_runtime_tactical_decision(text,text,text,text,jsonb,timestamp without time zone) FROM PUBLIC,anon,authenticated;
DO $grant$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT EXECUTE ON FUNCTION public.submit_match_runtime_tactical_decision(text,text,text,text,jsonb,timestamp without time zone) TO service_role;
END IF; END $grant$;
