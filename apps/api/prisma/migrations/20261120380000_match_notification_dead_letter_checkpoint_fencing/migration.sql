-- Bound notification retries and fence tactical-checkpoint acknowledgements.
ALTER TABLE public."MatchLifecycleNotification"
 ADD COLUMN IF NOT EXISTS "deadLetteredAt" TIMESTAMP(3),
 ADD COLUMN IF NOT EXISTS "completedDelivered" BOOLEAN;
ALTER TABLE public."MatchResultNotification"
 ADD COLUMN IF NOT EXISTS "deadLetteredAt" TIMESTAMP(3),
 ADD COLUMN IF NOT EXISTS "completedDelivered" BOOLEAN;
ALTER TABLE public."MatchTacticalCheckpoint"
 ADD COLUMN IF NOT EXISTS "homeBotNotificationClaimToken" TEXT,
 ADD COLUMN IF NOT EXISTS "awayBotNotificationClaimToken" TEXT,
 ADD COLUMN IF NOT EXISTS "homeBotNotificationCompletedClaimToken" TEXT,
 ADD COLUMN IF NOT EXISTS "awayBotNotificationCompletedClaimToken" TEXT,
 ADD COLUMN IF NOT EXISTS "homeBotNotificationCompletedDelivered" BOOLEAN,
 ADD COLUMN IF NOT EXISTS "awayBotNotificationCompletedDelivered" BOOLEAN,
 ADD COLUMN IF NOT EXISTS "homeBotNotificationDeadLetteredAt" TIMESTAMP(3),
 ADD COLUMN IF NOT EXISTS "awayBotNotificationDeadLetteredAt" TIMESTAMP(3);

UPDATE public."MatchLifecycleNotification" SET "status"='DEAD_LETTER',"deadLetteredAt"=COALESCE("deadLetteredAt",NOW()),
 "claimToken"=NULL,"lockedUntil"=NULL
 WHERE "status"='PENDING' AND "attempts">=8 AND ("lockedUntil" IS NULL OR "lockedUntil"<NOW()-INTERVAL '30 seconds');
UPDATE public."MatchResultNotification" SET "status"='DEAD_LETTER',"deadLetteredAt"=COALESCE("deadLetteredAt",NOW()),
 "claimToken"=NULL,"lockedUntil"=NULL
 WHERE "status"='PENDING' AND "attempts">=8 AND ("lockedUntil" IS NULL OR "lockedUntil"<NOW()-INTERVAL '30 seconds');

CREATE OR REPLACE FUNCTION public.claim_due_match_lifecycle_notifications_node_http(p_limit integer DEFAULT 50,p_lease_seconds integer DEFAULT 30)
RETURNS TABLE(id text,channel text,telegram_chat_id text,claim_token text,attempt integer,kind text,minute integer,home_score integer,away_score integer,payload jsonb,match_id text,home_club_name text,away_club_name text)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 WITH exhausted AS (
  UPDATE public."MatchLifecycleNotification" SET "status"='DEAD_LETTER',"deadLetteredAt"=COALESCE("deadLetteredAt",NOW()),
   "claimToken"=NULL,"lockedUntil"=NULL
  WHERE "status"='PENDING' AND "attempts">=8 AND ("lockedUntil" IS NULL OR "lockedUntil"<NOW()-INTERVAL '30 seconds')
  RETURNING "id"
 ), candidates AS (
  SELECT n."id" FROM public."MatchLifecycleNotification" n
  JOIN public."FootballMatch" m ON m."id"=n."matchId"
  WHERE n."status"='PENDING' AND n."attempts"<8 AND m."status"::text IN ('IN_PROGRESS','COMPLETED')
   AND n."availableAt"<=NOW() AND (n."lockedUntil" IS NULL OR n."lockedUntil"<NOW()-INTERVAL '30 seconds')
  ORDER BY n."availableAt",n."createdAt" FOR UPDATE OF n SKIP LOCKED
  LIMIT LEAST(GREATEST(COALESCE(p_limit,50),1),100)
 ), claimed AS (
  UPDATE public."MatchLifecycleNotification" n SET "claimToken"=gen_random_uuid()::text,
   "lockedUntil"=NOW()+make_interval(secs=>LEAST(GREATEST(COALESCE(p_lease_seconds,30),5),300)),
   "attempts"=n."attempts"+1,"completedClaimToken"=NULL,"completedDelivered"=NULL,"updatedAt"=NOW()
  FROM candidates c WHERE n."id"=c."id" RETURNING n.*
 )
 SELECT c."id",c."channel"::text,c."telegramChatId",c."claimToken",c."attempts",c."kind"::text,c."minute",
  c."homeScore",c."awayScore",c."payload",m."id",h."name",a."name"
 FROM claimed c JOIN public."FootballMatch" m ON m."id"=c."matchId"
 JOIN public."Club" h ON h."id"=m."homeClubId" JOIN public."Club" a ON a."id"=m."awayClubId";
$$;

CREATE OR REPLACE FUNCTION public.claim_due_match_result_notifications_node_http(p_limit integer DEFAULT 25,p_lease_seconds integer DEFAULT 30)
RETURNS TABLE(id text,channel text,telegram_chat_id text,claim_token text,attempt integer,match_id text,
 home_score integer,away_score integer,completed_at timestamp without time zone,home_club_id text,away_club_id text,
 home_club_name text,away_club_name text,performances jsonb)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 WITH exhausted AS (
  UPDATE public."MatchResultNotification" SET "status"='DEAD_LETTER',"deadLetteredAt"=COALESCE("deadLetteredAt",NOW()),
   "claimToken"=NULL,"lockedUntil"=NULL
  WHERE "status"='PENDING' AND "attempts">=8 AND ("lockedUntil" IS NULL OR "lockedUntil"<NOW()-INTERVAL '30 seconds')
  RETURNING "id"
 ), candidates AS (
  SELECT n."id" FROM public."MatchResultNotification" n JOIN public."FootballMatch" m ON m."id"=n."matchId"
  WHERE n."status"='PENDING' AND n."attempts"<8 AND n."availableAt"<=NOW() AND m."status"::text='COMPLETED'
   AND (n."lockedUntil" IS NULL OR n."lockedUntil"<NOW()-INTERVAL '30 seconds')
  ORDER BY n."createdAt" FOR UPDATE OF n SKIP LOCKED
  LIMIT LEAST(GREATEST(COALESCE(p_limit,25),1),100)
 ), claimed AS (
  UPDATE public."MatchResultNotification" n SET "claimToken"=gen_random_uuid()::text,
   "lockedUntil"=NOW()+make_interval(secs=>LEAST(GREATEST(COALESCE(p_lease_seconds,30),5),300)),
   "attempts"=n."attempts"+1,"completedClaimToken"=NULL,"completedDelivered"=NULL,"updatedAt"=NOW()
  FROM candidates c WHERE n."id"=c."id" RETURNING n.*
 )
 SELECT c."id",c."channel"::text,c."telegramChatId",c."claimToken",c."attempts",m."id",
  m."homeScore",m."awayScore",m."completedAt",m."homeClubId",m."awayClubId",h."name",a."name",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('club_id',p."clubId",'goals',p."goals",'shots',p."shots",
   'passes',p."passes",'tackles',p."tackles",'player_name',pl."firstName"||' '||pl."lastName")
   ORDER BY p."goals" DESC,pl."lastName",pl."firstName")
   FROM public."PlayerMatchPerformance" p JOIN public."Player" pl ON pl."id"=p."playerId" WHERE p."matchId"=m."id"),'[]'::jsonb)
 FROM claimed c JOIN public."FootballMatch" m ON m."id"=c."matchId"
 JOIN public."Club" h ON h."id"=m."homeClubId" JOIN public."Club" a ON a."id"=m."awayClubId";
$$;

CREATE OR REPLACE FUNCTION public.complete_match_notification_delivery(p_notification_type text,p_notification_id text,p_claim_token text,
 p_delivered boolean,p_error text DEFAULT NULL,p_retry_seconds integer DEFAULT 15)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE affected integer; retry_delay integer:=LEAST(GREATEST(COALESCE(p_retry_seconds,15),1),3600);
BEGIN
 IF p_notification_type='LIFECYCLE' THEN
  UPDATE public."MatchLifecycleNotification" SET
   "status"=CASE WHEN p_delivered THEN 'DELIVERED' WHEN "attempts">=8 THEN 'DEAD_LETTER' ELSE 'PENDING' END,
   "deliveredAt"=CASE WHEN p_delivered THEN NOW() ELSE NULL END,
   "deadLetteredAt"=CASE WHEN NOT p_delivered AND "attempts">=8 THEN NOW() ELSE NULL END,
   "availableAt"=CASE WHEN p_delivered OR "attempts">=8 THEN "availableAt" ELSE NOW()+make_interval(secs=>retry_delay) END,
   "claimToken"=NULL,"lockedUntil"=NULL,
   "lastError"=CASE WHEN p_delivered THEN NULL ELSE left(COALESCE(p_error,'TELEGRAM_SEND_FAILED'),500) END,
   "completedClaimToken"=p_claim_token,"completedDelivered"=p_delivered,"updatedAt"=NOW()
  WHERE "id"=p_notification_id AND "claimToken"=p_claim_token AND "status"='PENDING';
 ELSIF p_notification_type='RESULT' THEN
  UPDATE public."MatchResultNotification" SET
   "status"=CASE WHEN p_delivered THEN 'DELIVERED' WHEN "attempts">=8 THEN 'DEAD_LETTER' ELSE 'PENDING' END,
   "deliveredAt"=CASE WHEN p_delivered THEN NOW() ELSE NULL END,
   "deadLetteredAt"=CASE WHEN NOT p_delivered AND "attempts">=8 THEN NOW() ELSE NULL END,
   "availableAt"=CASE WHEN p_delivered OR "attempts">=8 THEN "availableAt" ELSE NOW()+make_interval(secs=>retry_delay) END,
   "claimToken"=NULL,"lockedUntil"=NULL,
   "lastError"=CASE WHEN p_delivered THEN NULL ELSE left(COALESCE(p_error,'TELEGRAM_SEND_FAILED'),500) END,
   "completedClaimToken"=p_claim_token,"completedDelivered"=p_delivered,"updatedAt"=NOW()
  WHERE "id"=p_notification_id AND "claimToken"=p_claim_token AND "status"='PENDING';
 ELSE RAISE EXCEPTION 'INVALID_MATCH_NOTIFICATION_TYPE';
 END IF;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected=1 THEN RETURN true; END IF;
 IF p_notification_type='LIFECYCLE' THEN
  RETURN EXISTS(SELECT 1 FROM public."MatchLifecycleNotification" WHERE "id"=p_notification_id
   AND "completedClaimToken"=p_claim_token AND "completedDelivered"=p_delivered
   AND ((p_delivered AND "status"='DELIVERED') OR (NOT p_delivered AND "status" IN ('PENDING','DEAD_LETTER'))));
 END IF;
 RETURN EXISTS(SELECT 1 FROM public."MatchResultNotification" WHERE "id"=p_notification_id
  AND "completedClaimToken"=p_claim_token AND "completedDelivered"=p_delivered
  AND ((p_delivered AND "status"='DELIVERED') OR (NOT p_delivered AND "status" IN ('PENDING','DEAD_LETTER'))));
END; $$;

DROP FUNCTION IF EXISTS public.claim_due_match_checkpoint_notifications_node_http(integer,text);
CREATE FUNCTION public.claim_due_match_checkpoint_notifications_node_http(p_limit integer DEFAULT 25,p_checkpoint_id text DEFAULT NULL)
RETURNS TABLE(checkpoint_id text,match_id text,checkpoint_key text,minute integer,deadline_at timestamp without time zone,
 club_id text,club_name text,opponent_name text,telegram_user_id text,side text,attempt integer,claim_token text)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE cp record; changed integer; v_token text;
BEGIN
 UPDATE public."MatchTacticalCheckpoint" SET "homeBotNotificationDeadLetteredAt"=COALESCE("homeBotNotificationDeadLetteredAt",NOW()),
  "homeBotNotificationClaimedAt"=NULL,"homeBotNotificationClaimToken"=NULL
 WHERE "status"='OPEN' AND "homeBotNotifiedAt" IS NULL AND "homeBotNotificationAttempts">=8
  AND ("homeBotNotificationClaimedAt" IS NULL OR "homeBotNotificationClaimedAt"<NOW()-INTERVAL '30 seconds');
 UPDATE public."MatchTacticalCheckpoint" SET "awayBotNotificationDeadLetteredAt"=COALESCE("awayBotNotificationDeadLetteredAt",NOW()),
  "awayBotNotificationClaimedAt"=NULL,"awayBotNotificationClaimToken"=NULL
 WHERE "status"='OPEN' AND "awayBotNotifiedAt" IS NULL AND "awayBotNotificationAttempts">=8
  AND ("awayBotNotificationClaimedAt" IS NULL OR "awayBotNotificationClaimedAt"<NOW()-INTERVAL '30 seconds');
 FOR cp IN
  SELECT c.*,m."id" AS match_id,m."homeClubId",m."awayClubId",hc."name" AS home_name,ac."name" AS away_name,
   hu."telegramId" AS home_telegram,au."telegramId" AS away_telegram,
   EXISTS(SELECT 1 FROM public."MatchTacticalDecision" d WHERE d."checkpointId"=c."id" AND d."clubId"=m."homeClubId") AS home_decided,
   EXISTS(SELECT 1 FROM public."MatchTacticalDecision" d WHERE d."checkpointId"=c."id" AND d."clubId"=m."awayClubId") AS away_decided
  FROM public."MatchTacticalCheckpoint" c JOIN public."FootballMatch" m ON m."id"=c."matchId"
  JOIN public."Club" hc ON hc."id"=m."homeClubId" JOIN public."Club" ac ON ac."id"=m."awayClubId"
  JOIN public."User" hu ON hu."id"=hc."ownerId" JOIN public."User" au ON au."id"=ac."ownerId"
  WHERE c."status"='OPEN' AND c."openedAt"<=NOW() AND c."decisionDeadlineAt">NOW()
   AND (p_checkpoint_id IS NULL OR c."id"=p_checkpoint_id)
   AND ((c."homeBotNotifiedAt" IS NULL AND c."homeBotNotificationDeadLetteredAt" IS NULL AND c."homeBotNotificationAttempts"<8
      AND (c."homeBotNotificationClaimedAt" IS NULL OR c."homeBotNotificationClaimedAt"<NOW()-INTERVAL '30 seconds'))
    OR (c."awayBotNotifiedAt" IS NULL AND c."awayBotNotificationDeadLetteredAt" IS NULL AND c."awayBotNotificationAttempts"<8
      AND (c."awayBotNotificationClaimedAt" IS NULL OR c."awayBotNotificationClaimedAt"<NOW()-INTERVAL '30 seconds')))
  ORDER BY c."openedAt",c."minute" FOR UPDATE OF c SKIP LOCKED
  LIMIT LEAST(GREATEST(COALESCE(p_limit,25),1),100)
 LOOP
  IF cp."homeBotNotifiedAt" IS NULL AND cp."homeBotNotificationDeadLetteredAt" IS NULL AND cp."homeBotNotificationAttempts"<8 THEN
   IF cp.home_decided THEN
    UPDATE public."MatchTacticalCheckpoint" SET "homeBotNotifiedAt"=NOW(),"homeBotNotificationClaimedAt"=NULL,"homeBotNotificationClaimToken"=NULL
     WHERE "id"=cp."id" AND "homeBotNotifiedAt" IS NULL;
   ELSE
    UPDATE public."MatchTacticalCheckpoint" SET "homeBotNotificationClaimedAt"=NOW(),
     "homeBotNotificationClaimToken"=gen_random_uuid()::text,"homeBotNotificationCompletedClaimToken"=NULL,
     "homeBotNotificationCompletedDelivered"=NULL,"homeBotNotificationAttempts"="homeBotNotificationAttempts"+1
     WHERE "id"=cp."id" AND "homeBotNotifiedAt" IS NULL AND "homeBotNotificationAttempts"<8
      AND "homeBotNotificationDeadLetteredAt" IS NULL
      AND ("homeBotNotificationClaimedAt" IS NULL OR "homeBotNotificationClaimedAt"<NOW()-INTERVAL '30 seconds')
     RETURNING "homeBotNotificationClaimToken" INTO v_token;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed=1 THEN checkpoint_id:=cp."id";match_id:=cp.match_id;checkpoint_key:=cp."checkpointKey";minute:=cp."minute";
     deadline_at:=cp."decisionDeadlineAt";club_id:=cp."homeClubId";club_name:=cp.home_name;opponent_name:=cp.away_name;
     telegram_user_id:=cp.home_telegram;side:='HOME';attempt:=cp."homeBotNotificationAttempts"+1;claim_token:=v_token;RETURN NEXT; END IF;
   END IF;
  END IF;
  IF cp."awayBotNotifiedAt" IS NULL AND cp."awayBotNotificationDeadLetteredAt" IS NULL AND cp."awayBotNotificationAttempts"<8 THEN
   IF cp.away_decided THEN
    UPDATE public."MatchTacticalCheckpoint" SET "awayBotNotifiedAt"=NOW(),"awayBotNotificationClaimedAt"=NULL,"awayBotNotificationClaimToken"=NULL
     WHERE "id"=cp."id" AND "awayBotNotifiedAt" IS NULL;
   ELSE
    UPDATE public."MatchTacticalCheckpoint" SET "awayBotNotificationClaimedAt"=NOW(),
     "awayBotNotificationClaimToken"=gen_random_uuid()::text,"awayBotNotificationCompletedClaimToken"=NULL,
     "awayBotNotificationCompletedDelivered"=NULL,"awayBotNotificationAttempts"="awayBotNotificationAttempts"+1
     WHERE "id"=cp."id" AND "awayBotNotifiedAt" IS NULL AND "awayBotNotificationAttempts"<8
      AND "awayBotNotificationDeadLetteredAt" IS NULL
      AND ("awayBotNotificationClaimedAt" IS NULL OR "awayBotNotificationClaimedAt"<NOW()-INTERVAL '30 seconds')
     RETURNING "awayBotNotificationClaimToken" INTO v_token;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed=1 THEN checkpoint_id:=cp."id";match_id:=cp.match_id;checkpoint_key:=cp."checkpointKey";minute:=cp."minute";
     deadline_at:=cp."decisionDeadlineAt";club_id:=cp."awayClubId";club_name:=cp.away_name;opponent_name:=cp.home_name;
     telegram_user_id:=cp.away_telegram;side:='AWAY';attempt:=cp."awayBotNotificationAttempts"+1;claim_token:=v_token;RETURN NEXT; END IF;
   END IF;
  END IF;
 END LOOP;
END; $$;

DROP FUNCTION IF EXISTS public.ack_match_checkpoint_notification_node_http(text,text,boolean,text);
CREATE FUNCTION public.ack_match_checkpoint_notification_node_http(p_checkpoint_id text,p_side text,p_claim_token text,p_delivered boolean,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE affected integer;
BEGIN
 IF p_side='HOME' THEN
  UPDATE public."MatchTacticalCheckpoint" SET
   "homeBotNotifiedAt"=CASE WHEN p_delivered THEN NOW() ELSE "homeBotNotifiedAt" END,
   "homeBotNotificationClaimedAt"=CASE WHEN p_delivered OR "homeBotNotificationAttempts">=8 THEN NULL ELSE "homeBotNotificationClaimedAt" END,
   "homeBotNotificationClaimToken"=NULL,"homeBotNotificationCompletedClaimToken"=p_claim_token,
   "homeBotNotificationCompletedDelivered"=p_delivered,
   "homeBotNotificationDeadLetteredAt"=CASE WHEN NOT p_delivered AND "homeBotNotificationAttempts">=8 THEN NOW() ELSE "homeBotNotificationDeadLetteredAt" END,
   "homeBotNotificationLastError"=CASE WHEN p_delivered THEN NULL ELSE left(COALESCE(p_error,'TELEGRAM_SEND_FAILED'),500) END
  WHERE "id"=p_checkpoint_id AND "status"='OPEN' AND "homeBotNotificationClaimToken"=p_claim_token;
 ELSIF p_side='AWAY' THEN
  UPDATE public."MatchTacticalCheckpoint" SET
   "awayBotNotifiedAt"=CASE WHEN p_delivered THEN NOW() ELSE "awayBotNotifiedAt" END,
   "awayBotNotificationClaimedAt"=CASE WHEN p_delivered OR "awayBotNotificationAttempts">=8 THEN NULL ELSE "awayBotNotificationClaimedAt" END,
   "awayBotNotificationClaimToken"=NULL,"awayBotNotificationCompletedClaimToken"=p_claim_token,
   "awayBotNotificationCompletedDelivered"=p_delivered,
   "awayBotNotificationDeadLetteredAt"=CASE WHEN NOT p_delivered AND "awayBotNotificationAttempts">=8 THEN NOW() ELSE "awayBotNotificationDeadLetteredAt" END,
   "awayBotNotificationLastError"=CASE WHEN p_delivered THEN NULL ELSE left(COALESCE(p_error,'TELEGRAM_SEND_FAILED'),500) END
  WHERE "id"=p_checkpoint_id AND "status"='OPEN' AND "awayBotNotificationClaimToken"=p_claim_token;
 ELSE RAISE EXCEPTION 'INVALID_MATCH_CHECKPOINT_NOTIFICATION_SIDE';
 END IF;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected=1 THEN RETURN true; END IF;
 IF p_side='HOME' THEN
  RETURN EXISTS(SELECT 1 FROM public."MatchTacticalCheckpoint" WHERE "id"=p_checkpoint_id
   AND "homeBotNotificationCompletedClaimToken"=p_claim_token AND "homeBotNotificationCompletedDelivered"=p_delivered);
 END IF;
 RETURN EXISTS(SELECT 1 FROM public."MatchTacticalCheckpoint" WHERE "id"=p_checkpoint_id
  AND "awayBotNotificationCompletedClaimToken"=p_claim_token AND "awayBotNotificationCompletedDelivered"=p_delivered);
END; $$;

REVOKE ALL ON FUNCTION public.claim_due_match_lifecycle_notifications_node_http(integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_due_match_result_notifications_node_http(integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_due_match_checkpoint_notifications_node_http(integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ack_match_checkpoint_notification_node_http(text,text,text,boolean,text) FROM PUBLIC,anon,authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
 GRANT EXECUTE ON FUNCTION public.claim_due_match_lifecycle_notifications_node_http(integer,integer) TO service_role;
 GRANT EXECUTE ON FUNCTION public.claim_due_match_result_notifications_node_http(integer,integer) TO service_role;
 GRANT EXECUTE ON FUNCTION public.claim_due_match_checkpoint_notifications_node_http(integer,text) TO service_role;
 GRANT EXECUTE ON FUNCTION public.ack_match_checkpoint_notification_node_http(text,text,text,boolean,text) TO service_role;
END IF; END $$;
