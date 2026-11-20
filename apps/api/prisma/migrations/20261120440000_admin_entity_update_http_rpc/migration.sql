CREATE OR REPLACE FUNCTION public.admin_entity_update_http(
 p_action text,p_target_id text,p_actor_telegram_id text,p_idempotency_key text,p_payload jsonb,p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE
 v_existing public."AdminAuditLog"%ROWTYPE;
 v_target_type text;
 v_target_id text:=p_target_id;
 v_metadata jsonb;
 v_status text;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('player-update','club-update','match-update','player-status','alliance-status','season-status')
  OR p_target_id IS NULL OR length(p_target_id) NOT BETWEEN 1 AND 128
  OR p_actor_telegram_id IS NULL OR p_actor_telegram_id !~ '^[0-9]{1,20}$'
  OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{12,128}$'
  OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_payload='{}'::jsonb
  OR (p_reason IS NOT NULL AND length(p_reason)>500) THEN
  RAISE EXCEPTION USING MESSAGE='INVALID_ADMIN_ENTITY_ACTION',ERRCODE='22023';
 END IF;
 v_metadata:=jsonb_build_object('payload',p_payload,'reason',p_reason);
 v_target_type:=CASE WHEN p_action IN ('player-update','player-status') THEN 'player'
  WHEN p_action='club-update' THEN 'club'
  WHEN p_action='match-update' THEN 'match'
  WHEN p_action='alliance-status' THEN 'alliance' ELSE 'alliance-season' END;
 PERFORM pg_advisory_xact_lock(hashtextextended('admin-entity:'||p_idempotency_key,0));
 SELECT * INTO v_existing FROM public."AdminAuditLog" WHERE "idempotencyKey"='admin-entity:'||p_idempotency_key;
 IF FOUND THEN
  IF v_existing."actorTelegramId"=p_actor_telegram_id AND v_existing.action=p_action
   AND v_existing."targetType"=v_target_type AND v_existing."targetId"=p_target_id AND v_existing.metadata=v_metadata THEN
   RETURN jsonb_build_object('ok',true,'targetType',v_target_type,'targetId',p_target_id,'replay',true);
  END IF;
  RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_KEY_REUSED',ERRCODE='23505';
 END IF;

 IF p_action='player-update' THEN
  IF NOT (p_payload ?| ARRAY['firstName','lastName','age','overall','potential','wage','contractDays','fitness','morale'])
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(key) WHERE key NOT IN ('firstName','lastName','age','overall','potential','wage','contractDays','fitness','morale')) THEN
   RAISE EXCEPTION USING MESSAGE='INVALID_PLAYER_UPDATE',ERRCODE='22023';
  END IF;
  IF (p_payload ? 'firstName' AND length(btrim(p_payload->>'firstName')) NOT BETWEEN 1 AND 60)
   OR (p_payload ? 'lastName' AND length(btrim(p_payload->>'lastName')) NOT BETWEEN 1 AND 60)
   OR (p_payload ? 'age' AND (p_payload->>'age' !~ '^[0-9]{1,2}$' OR (p_payload->>'age')::int NOT BETWEEN 15 AND 55))
   OR (p_payload ? 'overall' AND (p_payload->>'overall' !~ '^[0-9]{1,2}$' OR (p_payload->>'overall')::int NOT BETWEEN 1 AND 99))
   OR (p_payload ? 'potential' AND (p_payload->>'potential' !~ '^[0-9]{1,2}$' OR (p_payload->>'potential')::int NOT BETWEEN 1 AND 99))
   OR (p_payload ? 'wage' AND (p_payload->>'wage' !~ '^[0-9]{1,15}$'))
   OR (p_payload ? 'contractDays' AND (p_payload->>'contractDays' !~ '^[0-9]{1,4}$' OR (p_payload->>'contractDays')::int NOT BETWEEN 0 AND 3650))
   OR (p_payload ? 'fitness' AND (p_payload->>'fitness' !~ '^[0-9]{1,3}$' OR (p_payload->>'fitness')::int NOT BETWEEN 0 AND 100))
   OR (p_payload ? 'morale' AND (p_payload->>'morale' !~ '^[0-9]{1,3}$' OR (p_payload->>'morale')::int NOT BETWEEN 0 AND 100)) THEN
   RAISE EXCEPTION USING MESSAGE='INVALID_PLAYER_UPDATE',ERRCODE='22023';
  END IF;
  UPDATE public."Player" SET
   "firstName"=CASE WHEN p_payload ? 'firstName' THEN btrim(p_payload->>'firstName') ELSE "firstName" END,
   "lastName"=CASE WHEN p_payload ? 'lastName' THEN btrim(p_payload->>'lastName') ELSE "lastName" END,
   age=CASE WHEN p_payload ? 'age' THEN (p_payload->>'age')::int ELSE age END,
   overall=CASE WHEN p_payload ? 'overall' THEN (p_payload->>'overall')::int ELSE overall END,
   potential=CASE WHEN p_payload ? 'potential' THEN (p_payload->>'potential')::int ELSE potential END,
   wage=CASE WHEN p_payload ? 'wage' THEN (p_payload->>'wage')::bigint ELSE wage END,
   "contractDays"=CASE WHEN p_payload ? 'contractDays' THEN (p_payload->>'contractDays')::int ELSE "contractDays" END,
   fitness=CASE WHEN p_payload ? 'fitness' THEN (p_payload->>'fitness')::int ELSE fitness END,
   morale=CASE WHEN p_payload ? 'morale' THEN (p_payload->>'morale')::int ELSE morale END,
   "updatedAt"=clock_timestamp()
  WHERE id=p_target_id;
 ELSIF p_action='club-update' THEN
  IF NOT (p_payload ?| ARRAY['clubName','level','reputation','stadiumLevel','academyLevel','trainingGroundLevel','ticketPrice'])
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(key) WHERE key NOT IN ('clubName','level','reputation','stadiumLevel','academyLevel','trainingGroundLevel','ticketPrice')) THEN
   RAISE EXCEPTION USING MESSAGE='INVALID_CLUB_UPDATE',ERRCODE='22023';
  END IF;
  IF (p_payload ? 'clubName' AND length(btrim(p_payload->>'clubName')) NOT BETWEEN 2 AND 60)
   OR (p_payload ? 'level' AND (p_payload->>'level' !~ '^[0-9]{1,3}$' OR (p_payload->>'level')::int NOT BETWEEN 1 AND 100))
   OR (p_payload ? 'reputation' AND (p_payload->>'reputation' !~ '^[0-9]{1,7}$' OR (p_payload->>'reputation')::int NOT BETWEEN 0 AND 1000000))
   OR (p_payload ? 'stadiumLevel' AND (p_payload->>'stadiumLevel' !~ '^[0-9]{1,3}$' OR (p_payload->>'stadiumLevel')::int NOT BETWEEN 1 AND 100))
   OR (p_payload ? 'academyLevel' AND (p_payload->>'academyLevel' !~ '^[0-9]{1,3}$' OR (p_payload->>'academyLevel')::int NOT BETWEEN 0 AND 100))
   OR (p_payload ? 'trainingGroundLevel' AND (p_payload->>'trainingGroundLevel' !~ '^[0-9]{1,3}$' OR (p_payload->>'trainingGroundLevel')::int NOT BETWEEN 1 AND 100))
   OR (p_payload ? 'ticketPrice' AND p_payload->>'ticketPrice' !~ '^[0-9]{1,15}$') THEN
   RAISE EXCEPTION USING MESSAGE='INVALID_CLUB_UPDATE',ERRCODE='22023';
  END IF;
  UPDATE public."Club" SET
   name=CASE WHEN p_payload ? 'clubName' THEN btrim(p_payload->>'clubName') ELSE name END,
   level=CASE WHEN p_payload ? 'level' THEN (p_payload->>'level')::int ELSE level END,
   reputation=CASE WHEN p_payload ? 'reputation' THEN (p_payload->>'reputation')::int ELSE reputation END,
   "stadiumLevel"=CASE WHEN p_payload ? 'stadiumLevel' THEN (p_payload->>'stadiumLevel')::int ELSE "stadiumLevel" END,
   "academyLevel"=CASE WHEN p_payload ? 'academyLevel' THEN (p_payload->>'academyLevel')::int ELSE "academyLevel" END,
   "trainingGroundLevel"=CASE WHEN p_payload ? 'trainingGroundLevel' THEN (p_payload->>'trainingGroundLevel')::int ELSE "trainingGroundLevel" END,
   "ticketPrice"=CASE WHEN p_payload ? 'ticketPrice' THEN (p_payload->>'ticketPrice')::bigint ELSE "ticketPrice" END,
   "updatedAt"=clock_timestamp()
  WHERE id=p_target_id;
 ELSIF p_action='match-update' THEN
  IF NOT (p_payload ?| ARRAY['scheduledAt','homeScore','awayScore','matchStatus'])
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(key) WHERE key NOT IN ('scheduledAt','homeScore','awayScore','matchStatus')) THEN
   RAISE EXCEPTION USING MESSAGE='INVALID_MATCH_UPDATE',ERRCODE='22023';
  END IF;
  IF (p_payload ? 'scheduledAt' AND (p_payload->>'scheduledAt') IS NULL)
   OR (p_payload ? 'homeScore' AND (p_payload->>'homeScore' !~ '^[0-9]{1,2}$' OR (p_payload->>'homeScore')::int NOT BETWEEN 0 AND 99))
   OR (p_payload ? 'awayScore' AND (p_payload->>'awayScore' !~ '^[0-9]{1,2}$' OR (p_payload->>'awayScore')::int NOT BETWEEN 0 AND 99))
   OR (p_payload ? 'matchStatus' AND p_payload->>'matchStatus'='COMPLETED') THEN
   RAISE EXCEPTION USING MESSAGE='MATCH_COMPLETION_AUTOMATIC_ONLY',ERRCODE='P0001';
  END IF;
  IF (p_payload ? 'matchStatus' AND (p_payload->>'matchStatus' IS NULL OR p_payload->>'matchStatus' NOT IN ('SCHEDULED','CANCELLED'))) THEN
   RAISE EXCEPTION USING MESSAGE='INVALID_MATCH_UPDATE',ERRCODE='22023';
  END IF;
  UPDATE public."FootballMatch" SET
   "scheduledAt"=CASE WHEN p_payload ? 'scheduledAt' THEN (p_payload->>'scheduledAt')::timestamptz ELSE "scheduledAt" END,
   "homeScore"=CASE WHEN p_payload ? 'homeScore' THEN (p_payload->>'homeScore')::int ELSE "homeScore" END,
   "awayScore"=CASE WHEN p_payload ? 'awayScore' THEN (p_payload->>'awayScore')::int ELSE "awayScore" END,
   status=CASE WHEN p_payload ? 'matchStatus' THEN (p_payload->>'matchStatus')::public."MatchStatus" ELSE status END,
   "updatedAt"=clock_timestamp()
  WHERE id=p_target_id AND status NOT IN ('COMPLETED','IN_PROGRESS');
  IF NOT FOUND THEN
   IF EXISTS(SELECT 1 FROM public."FootballMatch" WHERE id=p_target_id AND status IN ('COMPLETED','IN_PROGRESS')) THEN
    RAISE EXCEPTION USING MESSAGE='MATCH_ALREADY_STARTED',ERRCODE='P0001';
   END IF;
   RAISE EXCEPTION USING MESSAGE='TARGET_NOT_FOUND',ERRCODE='P0002';
  END IF;
 ELSIF p_action='player-status' THEN
  IF p_payload->>'status' IS NULL OR p_payload->>'status' NOT IN ('ACTIVE','RETIRED') OR jsonb_object_length(p_payload)<>1 THEN RAISE EXCEPTION USING MESSAGE='INVALID_PLAYER_STATUS',ERRCODE='22023'; END IF;
  UPDATE public."Player" SET status=(p_payload->>'status')::public."PlayerStatus",
   "lineupSlot"=CASE WHEN p_payload->>'status'='RETIRED' THEN NULL ELSE "lineupSlot" END,"updatedAt"=clock_timestamp()
  WHERE id=p_target_id;
 ELSIF p_action='alliance-status' THEN
  IF p_payload->>'status' IS NULL OR p_payload->>'status' NOT IN ('ACTIVE','SUSPENDED','DISSOLVED') OR jsonb_object_length(p_payload)<>1 THEN RAISE EXCEPTION USING MESSAGE='INVALID_ALLIANCE_STATUS',ERRCODE='22023'; END IF;
  UPDATE public."Alliance" SET status=(p_payload->>'status')::public."AllianceStatus","updatedAt"=clock_timestamp() WHERE id=p_target_id;
 ELSE
  IF p_payload->>'status' IS NULL OR p_payload->>'status' NOT IN ('ACTIVE','CANCELLED') OR jsonb_object_length(p_payload)<>1 THEN RAISE EXCEPTION USING MESSAGE='INVALID_SEASON_STATUS',ERRCODE='22023'; END IF;
  UPDATE public."AllianceSeason" SET status=p_payload->>'status' WHERE id=p_target_id AND status<>'COMPLETED';
  IF NOT FOUND THEN
   IF EXISTS(SELECT 1 FROM public."AllianceSeason" WHERE id=p_target_id AND status='COMPLETED') THEN RAISE EXCEPTION USING MESSAGE='ALLIANCE_SEASON_ALREADY_SETTLED',ERRCODE='P0001'; END IF;
   RAISE EXCEPTION USING MESSAGE='TARGET_NOT_FOUND',ERRCODE='P0002';
  END IF;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='TARGET_NOT_FOUND',ERRCODE='P0002'; END IF;
 INSERT INTO public."AdminAuditLog"(id,"actorTelegramId",action,"targetType","targetId",reason,metadata,"idempotencyKey","createdAt")
 VALUES(gen_random_uuid()::text,p_actor_telegram_id,p_action,v_target_type,v_target_id,p_reason,v_metadata,'admin-entity:'||p_idempotency_key,clock_timestamp());
 RETURN jsonb_build_object('ok',true,'targetType',v_target_type,'targetId',v_target_id,'replay',false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_entity_update_http(text,text,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
DO $grant$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT EXECUTE ON FUNCTION public.admin_entity_update_http(text,text,text,text,jsonb) TO service_role;
 END IF;
END;
$grant$;
